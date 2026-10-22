import type { QualityReport } from '@chartguard/core';
import {
	type AxisSemantics,
	type ChartSemantics,
	type CoordinateSystem,
	type Default,
	type Fact,
	isBoolean,
	isNumber,
	isString,
	type Item,
	itemsAt,
	type KnownFact,
	type Listed,
	type Orientation,
	readFact,
	review,
	type ScaleType,
	type TitleSemantics,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

import { FROM_SERIES, seriesOf } from './series.js';

/**
 * A y axis without a title text takes the language's `yAxisTitle` (`text: this.chart.options.lang.yAxisTitle`,
 * highcharts.src.js:20306), `Values` by default. A global `Highcharts.setOptions` is not in the config.
 */
const Y_TITLE: Default<string> = {
	value: 'Values',
	pointer: "highcharts@13.1.1 highcharts.src.js:5060 yAxisTitle: 'Values',"
};

/** Highcharts titles: a string, or `null`, the documented way to hide one. */
const isTitle = (value: unknown): value is string | null => value === null || typeof value === 'string';

/**
 * A title from its text: `null` hides it (no text, not shown); otherwise Highcharts has no switch of
 * its own (a title shows when it has text), so whether it is shown is not modelled.
 */
function titleOf(text: Fact<string | null>, at: string): TitleSemantics {
	if (text.known && text.value === null)
		return { text: { ...text, value: '' }, shown: { known: true, value: false, path: text.path, source: 'config' } };
	return { text: text as Fact<string>, shown: unknown(at, 'unmodelled') };
}

/** An axis title text: its own; for y axes, else the chart's `lang.yAxisTitle`, else `Values`. */
function axisTitle(
	config: unknown,
	segments: readonly (string | number)[],
	name: 'xAxis' | 'yAxis'
): Fact<string | null> {
	const own = readFact(config, [...segments, 'title', 'text'], isTitle);
	if (name === 'xAxis' || own.known || own.reason !== 'unset') return own;
	const lang = readFact(config, ['lang', 'yAxisTitle'], isTitle);
	if (lang.known || lang.reason !== 'unset') return lang;
	return { known: true, value: Y_TITLE.value, path: own.path, source: 'default', pointer: Y_TITLE.pointer };
}

const TITLE_TEXT: Default<string> = {
	value: 'Chart title',
	pointer: "highcharts@13.1.1 highcharts.src.js:5417 text: 'Chart title',"
};

const defaultAt = <T>(value: T, path: string): Fact<T> => ({
	known: true,
	value,
	path,
	source: 'default',
	pointer: FROM_SERIES
});

/** Polar when `chart.polar` says so; no built-in series type requires it. */
function coordinateSystemOf(config: unknown): Fact<CoordinateSystem> {
	const polar = readFact(config, ['chart', 'polar'], isBoolean);
	if (polar.known) return { ...polar, value: polar.value ? 'polar' : 'cartesian' };
	return polar.reason === 'unset' ? defaultAt('cartesian', polar.path) : polar;
}

/**
 * Whether a `bar` series inverts the chart: the chart type, or the own type of any series, is `bar`
 * (its class has `inverted: true`). Unknown when a type that could be `bar` cannot be read.
 */
function barInverts(config: unknown, items: Listed<Item>): Fact<boolean> | undefined {
	if (!items.known) return items;
	const types = [
		readFact(config, ['chart', 'type'], isString),
		...items.items.map((item) => readFact(config, [...item.segments, 'type'], isString))
	];
	const bar = types.find((type): type is KnownFact<string> => type.known && type.value === 'bar');
	if (bar !== undefined) return { ...bar, value: true };
	return types.find((type): type is UnknownFact => !type.known && type.reason !== 'unset');
}

/**
 * Every cartesian series of a chart has one orientation: horizontal when the chart is `inverted`,
 * which a `bar` series also turns on (`chart.inverted: false` does not stop it: `optionsChart[key] || …`).
 */
function orientationOf(config: unknown, items: Listed<Item>): Fact<Orientation> {
	const inverted = readFact(config, ['chart', 'inverted'], isBoolean);
	if (inverted.known && inverted.value) return { ...inverted, value: 'horizontal' };
	if (!inverted.known && inverted.reason !== 'unset') return inverted;
	const bar = barInverts(config, items);
	if (bar === undefined) return defaultAt('vertical', inverted.path);
	return bar.known ? { ...bar, value: 'horizontal' } : bar;
}

const AXIS_TYPE = "highcharts@13.1.1 highcharts.src.js:20136 axis.type = options.type || 'linear';";
/** A y axis is reversed only when its options say so; x axes of inverted charts are reversed by default (:20261). */
const Y_REVERSED: Default<boolean> = {
	value: false,
	pointer: 'highcharts@13.1.1 highcharts.src.js:20154 axis.reversed = options.reversed;'
};
const SCALE_TYPES: Readonly<Record<string, ScaleType>> = {
	linear: 'linear',
	logarithmic: 'log',
	category: 'category',
	datetime: 'time'
};

function scaleOf(config: unknown, path: readonly (string | number)[]): Fact<ScaleType> {
	const type = readFact(config, [...path, 'type'], isString, { value: 'linear', pointer: AXIS_TYPE });
	return type.known ? { ...type, value: SCALE_TYPES[type.value] ?? 'other' } : type;
}

function axesOf(config: unknown): AxisSemantics[] {
	return (['xAxis', 'yAxis'] as const).flatMap((name) => {
		const axes = itemsAt(config, [name], { single: true });
		if (!axes.known) return [];
		// Without options Highcharts still creates one axis of each kind (`splat(options[coll] || {})`, :38885).
		const items = axes.items.length > 0 ? axes.items : [{ value: undefined, segments: [name], path: axes.path }];
		return items.map((axis, index) => ({
			key: `${name}[${String(index)}]`,
			path: axis.path,
			scale: scaleOf(config, axis.segments),
			min: readFact(config, [...axis.segments, 'min'], isNumber),
			max: readFact(config, [...axis.segments, 'max'], isNumber),
			reversed: readFact(config, [...axis.segments, 'reversed'], isBoolean, name === 'yAxis' ? Y_REVERSED : undefined),
			title: titleOf(axisTitle(config, axis.segments, name), `${axis.path}.title`)
		}));
	});
}

/** The Highcharts options as library-neutral chart semantics (CG-05-02, CG-05-03). */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series']);
	const chart = { coordinateSystem: coordinateSystemOf(config), orientation: orientationOf(config, items) };
	return {
		library: 'highcharts',
		title: titleOf(readFact(config, ['title', 'text'], isTitle, TITLE_TEXT), '$.title'),
		series: items.known ? { ...items, items: items.items.map((item) => seriesOf(config, item, chart)) } : items,
		axes: axesOf(config)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}
