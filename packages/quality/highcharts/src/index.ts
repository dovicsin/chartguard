import type { QualityReport } from '@chartguard/core';
import {
	type AccessSemantics,
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
	type QualityOptions,
	readFact,
	review,
	type ScaleType,
	type SeriesSemantics,
	type TitleSemantics,
	unknown,
	type UnknownFact,
	valueOf,
	withFixes,
	type ZeroFit
} from '@chartguard/quality-core';

import { seriesColors } from './color.js';
import { REMEDIES } from './fixes.js';
import { motionOf } from './motion.js';
import { FROM_SERIES, seriesOf, seriesOption } from './series.js';
import { backgroundOf } from './shades.js';

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

/** Without `labels.format` or a formatter, labels are plain numbers (with `k`, `M` for magnitudes). */
const PLAIN: Default<string> = {
	value: '',
	pointer: 'highcharts@13.1.1 highcharts.src.js:19474 return axis.defaultLabelFormatter.call(ctx);'
};
/** `{value}` with an optional number format, or `{text}`: the default label (:19471). */
const PLACEHOLDER = /\{(?:value(?::[^}]*)?|text)\}/gu;

/**
 * The unit of an axis's labels: a `formatter` decides at runtime and comes first; a `format` shows the
 * value through its placeholders, so the rest is the unit. Other template parts are not modelled.
 */
function unitOf(config: unknown, segments: readonly (string | number)[]): Fact<string> {
	const formatter = readFact(config, [...segments, 'labels', 'formatter'], (_value): _value is never => false);
	if (formatter.known || formatter.reason !== 'unset') return formatter;
	const format = readFact(config, [...segments, 'labels', 'format'], isString, PLAIN);
	if (!format.known || format.source === 'default') return format;
	const rest = format.value.replace(PLACEHOLDER, '');
	if (rest === format.value || rest.includes('{')) return unknown(format.path, 'unmodelled');
	return { ...format, value: rest.trim() };
}

/** A soft threshold is on unless a series turns it off (`softThreshold: true`). */
const SOFT: Default<boolean> = {
	value: true,
	pointer: 'highcharts@13.1.1 highcharts.src.js:32173 softThreshold: true,'
};

/** The bar on axis `key` that fits it to the data (a hard or no threshold), as an unknown `layout` fact. */
function fittedBy(
	config: unknown,
	item: Item,
	{ kind, type, valueAxis, base }: SeriesSemantics,
	key: string
): UnknownFact | undefined {
	if (valueOf(kind) !== 'bar' || valueOf(valueAxis) !== key || !type.known) return undefined;
	const soft = seriesOption(config, item, type.value, { name: 'softThreshold', is: isBoolean, fallback: SOFT });
	if (soft.known && !soft.value) return unknown(soft.path, 'layout');
	return !base.known && base.reason === 'layout' ? base : undefined;
}

/**
 * Highcharts fits a y axis to the data when a bar on it turns its soft threshold off or has no
 * threshold (`null`): the range then follows the tick algorithm, which depends on the plot size.
 */
function fitOf(config: unknown, key: string, at: string, series: Series): Fact<ZeroFit> {
	if (!series.items.known || !series.semantics.known) return unknown(at, 'unset');
	const { items } = series.items;
	const fitted = series.semantics.items.map((semantics, index) => {
		const item = items[index];
		return item === undefined ? undefined : fittedBy(config, item, semantics, key);
	});
	return fitted.find((fact) => fact !== undefined) ?? unknown(at, 'unset');
}

/** The series as read and as semantics. */
interface Series {
	readonly items: Listed<Item>;
	readonly semantics: Listed<SeriesSemantics>;
}

function axesOf(config: unknown, series: Series): AxisSemantics[] {
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
			fit: fitOf(config, `${name}[${String(index)}]`, axis.path, series),
			unit: unitOf(config, axis.segments),
			reversed: readFact(config, [...axis.segments, 'reversed'], isBoolean, name === 'yAxis' ? Y_REVERSED : undefined),
			title: titleOf(axisTitle(config, axis.segments, name), `${axis.path}.title`)
		}));
	});
}

/**
 * With `accessibility.enabled: false` Highcharts labels its points for no one and takes no keyboard
 * focus (measured: only the SVG keeps a label, the chart title). Otherwise both need the accessibility
 * module, which the config does not show: not modelled unless the config turns keyboard navigation off.
 */
function accessOf(config: unknown): AccessSemantics {
	const enabled = readFact(config, ['accessibility', 'enabled'], isBoolean);
	if (enabled.known && !enabled.value) return { dataDescribed: enabled, keyboard: enabled };
	const keyboard = readFact(config, ['accessibility', 'keyboardNavigation', 'enabled'], isBoolean);
	return {
		dataDescribed: enabled.known || enabled.reason === 'unset' ? unknown(enabled.path, 'unmodelled') : enabled,
		keyboard:
			keyboard.known && !keyboard.value
				? keyboard
				: unknown(keyboard.path, keyboard.known || keyboard.reason === 'unset' ? 'unmodelled' : keyboard.reason)
	};
}

/** The Highcharts options as library-neutral chart semantics (CG-05-02, CG-05-03). */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series']);
	const chart = { coordinateSystem: coordinateSystemOf(config), orientation: orientationOf(config, items) };
	const colors = seriesColors(config, items);
	const series: Listed<SeriesSemantics> = items.known
		? {
				...items,
				items: items.items.map((item, index) =>
					seriesOf(config, item, chart, colors[index] ?? unknown(item.path, 'unmodelled'))
				)
			}
		: items;
	return {
		library: 'highcharts',
		title: titleOf(readFact(config, ['title', 'text'], isTitle, TITLE_TEXT), '$.title'),
		series,
		axes: axesOf(config, { items, semantics: series }),
		access: accessOf(config),
		background: backgroundOf(config),
		motion: motionOf(config, items)
	};
}

/** The options `analyze` takes, and their check: re-exported so a consumer needs only this adapter. */
export type { QualityOptions } from '@chartguard/quality-core';
export { assertQualityOptions, QualityOptionsError } from '@chartguard/quality-core';

/** The rules' advisory findings on the config, shaped by the caller's rule settings and context (CG-05-05). */
export function analyze(config: unknown, options?: QualityOptions): QualityReport {
	const reviewed = (input: unknown): QualityReport => review(normalize(input), options);
	// Each fix is offered only when the config with it applied, reviewed the same way, no longer has the finding nor a new one.
	return withFixes(reviewed(config), config, REMEDIES, reviewed);
}
