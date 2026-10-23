import type { QualityReport } from '@chartguard/core';
import {
	type AccessSemantics,
	type AxisSemantics,
	type ChartSemantics,
	type CoordinateSystem,
	type Default,
	type Fact,
	formatPath,
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
import { axisTitleOf, chartTitleOf } from './titles.js';

/** The option that rounds each bound out to a tick, by bound. */
const ON_TICK = { min: 'startOnTick', max: 'endOnTick' } as const;

/**
 * An axis bound as drawn: a y axis starts and ends on a tick by default (`startOnTick`/`endOnTick`,
 * highcharts.src.js:18889, :18585), and `trimTicks` then replaces the configured bound by the tick
 * below (or above) it (`this.min = roundedMin`, :21409), at a tick interval the plot size decides
 * (`layout`). A bound of zero stays zero; with the rounding off it stays what the config says (H7).
 * An x axis does not round by default (:17788, :16778).
 */
function boundOf(
	config: unknown,
	segments: readonly (string | number)[],
	name: 'xAxis' | 'yAxis',
	key: 'min' | 'max'
): Fact<number> {
	const bound = readFact(config, [...segments, key], isNumber);
	if (!bound.known || bound.value === 0) return bound;
	const rounds = readFact(config, [...segments, ON_TICK[key]], isBoolean);
	if (!rounds.known && rounds.reason !== 'unset') return unknown(bound.path, rounds.reason);
	const rounding = rounds.known ? rounds.value : name === 'yAxis';
	return rounding ? unknown(bound.path, 'layout') : bound;
}

/** An axis's place in the plot: a length in pixels or a percentage of the plot. */
const isLength = (value: unknown): value is number | string => isNumber(value) || isString(value);
const PANE = ['top', 'height', 'left', 'width'] as const;
/** Without them an axis spans the whole plot (`options.top ?? chart.plotTop + offsets[0]`, …). */
const WHOLE_PLOT =
	'highcharts@13.1.1 highcharts.src.js:21812 chart.plotHeight - offsets[0] + offsets[2]), chart.plotHeight)), top = this.top = Math.round(relativeLength((options.top ?? chart.plotTop + offsets[0]), chart.plotHeight, chart.plotTop)), left = this.left = Math.round(relativeLength((options.left ?? chart.plotLeft + offsets[3]), chart.plotWidth, chart.plotLeft));';

/**
 * The pane an axis is drawn in: the whole plot, unless `top`, `height`, `left` or `width` place it
 * (Highcharts Stock panes). Axes placed the same way share one pane; any other placement is a pane
 * of its own here, even when the boxes overlap: never a claim that two axes share a plot.
 */
function panelOf(config: unknown, segments: readonly (string | number)[]): Fact<string> {
	const facts = PANE.map((key) => readFact(config, [...segments, key], isLength));
	const unreadable = facts.find((fact): fact is UnknownFact => !fact.known && fact.reason !== 'unset');
	if (unreadable !== undefined) return unreadable;
	const placed = facts.filter((fact) => fact.known);
	const [first] = placed;
	if (first === undefined)
		return { known: true, value: 'plot', path: `${formatPath(segments)}.top`, source: 'default', pointer: WHOLE_PLOT };
	const value = PANE.map((key, index) => {
		const fact = facts[index];
		return `${key}=${fact?.known === true ? String(fact.value) : ''}`;
	}).join(';');
	return { ...first, value };
}

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
			min: boundOf(config, axis.segments, name, 'min'),
			max: boundOf(config, axis.segments, name, 'max'),
			fit: fitOf(config, `${name}[${String(index)}]`, axis.path, series),
			unit: unitOf(config, axis.segments),
			panel: panelOf(config, axis.segments),
			reversed: readFact(config, [...axis.segments, 'reversed'], isBoolean, name === 'yAxis' ? Y_REVERSED : undefined),
			title: axisTitleOf(config, axis.segments, name, `${axis.path}.title`)
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
		title: chartTitleOf(config),
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
