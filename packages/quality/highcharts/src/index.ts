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
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

import { FROM_SERIES, seriesOf } from './series.js';

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
		return axes.items.map((axis, index) => ({
			key: `${name}[${String(index)}]`,
			path: axis.path,
			scale: scaleOf(config, axis.segments),
			min: readFact(config, [...axis.segments, 'min'], isNumber),
			max: readFact(config, [...axis.segments, 'max'], isNumber),
			reversed: readFact(config, [...axis.segments, 'reversed'], isBoolean, name === 'yAxis' ? Y_REVERSED : undefined),
			title: readFact(config, [...axis.segments, 'title', 'text'], isString)
		}));
	});
}

/** The Highcharts options as library-neutral chart semantics (CG-05-02, CG-05-03). */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series']);
	const chart = { coordinateSystem: coordinateSystemOf(config), orientation: orientationOf(config, items) };
	return {
		library: 'highcharts',
		title: {
			text: readFact(config, ['title', 'text'], isString, TITLE_TEXT),
			// Highcharts has no switch: a title shows unless its text is empty; not modelled yet.
			shown: unknown('$.title.text', 'unmodelled')
		},
		series: items.known ? { ...items, items: items.items.map((item) => seriesOf(config, item, chart)) } : items,
		axes: axesOf(config)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}
