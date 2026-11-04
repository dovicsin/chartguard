import {
	type CoordinateSystem,
	type Default,
	type Fact,
	firstSet,
	isNumber,
	isStaticValue,
	isString,
	type Item,
	itemsAt,
	type Listed,
	type Orientation,
	readFact,
	readPath,
	type SeriesKind,
	type SeriesSemantics,
	type Stacking,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

import { shadesOf } from './shades.js';
import { scopedFacts, seriesOption, seriesType } from './type.js';
import { valuesOf } from './values.js';

/** A series binds the axis its `yAxis` names by index or id, else the first (`Series#bindAxes`). */
const BIND_AXIS = 'highcharts@13.1.1 highcharts.src.js:33142 if ((seriesOptions[coll] ?? 0) === axis.index ||';
/** `inverted` and `polar` come from the chart options, else from a series type that requires them (`propFromSeries`). */
export const FROM_SERIES = 'highcharts@13.1.1 highcharts.src.js:39893 optionsChart[key] ||';
/** Series stack only when their `stacking` is set. */
const STACKS =
	'highcharts@13.1.1 highcharts.src.js:38728 if (serie.options.stacking || serie.options.centerInCategory) {';

const KINDS: Readonly<Record<string, SeriesKind>> = {
	column: 'bar',
	bar: 'bar',
	line: 'line',
	spline: 'line',
	area: 'area',
	areaspline: 'area',
	scatter: 'scatter',
	pie: 'pie'
};
const STACKINGS: Readonly<Record<string, Stacking>> = { normal: 'stacked', percent: 'percent' };

/** What the whole chart decides for its series: its coordinate system and whether it is inverted. */
export interface ChartLayout {
	readonly coordinateSystem: Fact<CoordinateSystem>;
	readonly orientation: Fact<Orientation>;
}

/** The y axis the series' `yAxis` names by index or id, else the first; in polar charts the radial axis. */
function boundAxis(config: unknown, named: Fact<number | string>): Fact<string> {
	if (!named.known && named.reason !== 'unset') return named;
	const axes: Listed<Item> = itemsAt(config, ['yAxis'], { single: true });
	if (!axes.known) return unknown(named.path, axes.reason);
	const reference = named.known ? named.value : 0;
	// Without `yAxis` options Highcharts creates one axis (`options[coll] = splat(options[coll] || {})`, highcharts.src.js:38885).
	const items = axes.items.length === 0 ? [{ value: {} }] : axes.items;
	const index = items.findIndex(
		(axis, position) => position === reference || readPath(axis.value, ['id']) === reference
	);
	if (index < 0) return unknown(named.path, 'unmodelled');
	const key = `yAxis[${String(index)}]`;
	return named.known
		? { ...named, value: key }
		: { known: true, value: key, path: named.path, source: 'default', pointer: BIND_AXIS };
}

/** `stacking` resolves through the series, the options for its type and those for every series. */
function stackingOf(config: unknown, item: Item, type: Fact<string>): Fact<Stacking> {
	const stacking = firstSet(scopedFacts(config, item, type, { name: 'stacking', is: isStaticValue }));
	if (!stacking.known)
		return stacking.reason === 'unset'
			? { known: true, value: 'none', path: stacking.path, source: 'default', pointer: STACKS }
			: stacking;
	if (stacking.value === null || stacking.value === '') return { ...stacking, value: 'none' };
	const mapped = typeof stacking.value === 'string' ? STACKINGS[stacking.value] : undefined;
	// `stream` and `overlap` are not modelled yet.
	return mapped === undefined ? unknown(stacking.path, 'unmodelled') : { ...stacking, value: mapped };
}

/** Columns and bars grow from their `threshold`, zero by default; `null` grows them from the axis minimum. */
const THRESHOLD: Default<number | null> = {
	value: 0,
	pointer: 'highcharts@13.1.1 highcharts.src.js:44250 threshold: 0, [in const ColumnSeriesDefaults]'
};
const isThreshold = (value: unknown): value is number | null => value === null || isNumber(value);

/** Whether the y axis `key` (`yAxis[i]`) may be logarithmic: its type is not known to be another. */
function maybeLog(config: unknown, key: string): boolean {
	const axes = itemsAt(config, ['yAxis'], { single: true });
	const axis = axes.known ? axes.items[Number(key.slice('yAxis['.length, -1))] : undefined;
	if (axis === undefined) return !axes.known;
	const type = readFact(config, [...axis.segments, 'type'], isString);
	return type.known ? type.value === 'logarithmic' : type.reason !== 'unset';
}

/**
 * A bar's base: its `threshold`. With `null` the bars grow from the axis minimum, which the tick
 * algorithm fits to the data and the plot size: `layout`. A logarithmic axis has no zero; a threshold
 * outside its range is moved to its minimum (`getThreshold`): not modelled.
 */
function baseOf(config: unknown, item: Item, type: Fact<string>, valueAxis: Fact<string>): Fact<number> {
	const at = `${item.path}.threshold`;
	if (!type.known || KINDS[type.value] !== 'bar') return unknown(at, type.known ? 'inapplicable' : type.reason);
	if (!valueAxis.known) return unknown(at, valueAxis.reason);
	if (maybeLog(config, valueAxis.value)) return unknown(at, 'inapplicable');
	const threshold = seriesOption(config, item, type, { name: 'threshold', is: isThreshold, fallback: THRESHOLD });
	if (!threshold.known) return threshold;
	return threshold.value === null ? unknown(threshold.path, 'layout') : (threshold as Fact<number>);
}

type Layout = Pick<SeriesSemantics, 'coordinateSystem' | 'orientation' | 'valueAxis' | 'stacking'>;

const none = (item: Item, reason: UnknownFact['reason']): Layout => ({
	coordinateSystem: unknown(item.path, reason),
	orientation: unknown(item.path, reason),
	valueAxis: unknown(`${item.path}.yAxis`, reason),
	stacking: unknown(`${item.path}.stacking`, reason)
});

/**
 * The y axis carries the values (also for horizontal `bar` and inverted charts, and radially in polar
 * ones). Pie series have no axes; types without these axes are not modelled.
 */
function layoutOf(config: unknown, item: Item, type: Fact<string>, chart: ChartLayout): Layout {
	if (!type.known) return none(item, type.reason);
	if (KINDS[type.value] === 'pie') return none(item, 'inapplicable');
	if (KINDS[type.value] === undefined) return none(item, 'unmodelled');
	const named = readFact(
		config,
		[...item.segments, 'yAxis'],
		(value): value is number | string => isNumber(value) || isString(value)
	);
	const polar = chart.coordinateSystem.known && chart.coordinateSystem.value === 'polar';
	return {
		coordinateSystem: chart.coordinateSystem,
		orientation: polar ? unknown(item.path, 'inapplicable') : chart.orientation,
		valueAxis: boundAxis(config, named),
		stacking: stackingOf(config, item, type)
	};
}

export function seriesOf(
	config: unknown,
	item: Item,
	chart: ChartLayout,
	color: Fact<string>
): Omit<SeriesSemantics, 'legend'> {
	const type = seriesType(config, item);
	const layout = layoutOf(config, item, type, chart);
	return {
		path: item.path,
		type,
		kind: type.known ? { ...type, value: KINDS[type.value] ?? 'other' } : type,
		name: readFact(config, [...item.segments, 'name'], isString),
		...layout,
		base: baseOf(config, item, type, layout.valueAxis),
		color,
		shades: shadesOf(config, color),
		values: valuesOf(config, item, type)
	};
}
