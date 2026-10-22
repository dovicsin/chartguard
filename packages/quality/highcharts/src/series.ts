import {
	type CoordinateSystem,
	type Default,
	type Fact,
	firstSet,
	isNumber,
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

import { valuesOf } from './values.js';

const CHART_TYPE: Default<string> = {
	value: 'line',
	pointer: "highcharts@13.1.1 highcharts.src.js:1191 type: 'line',"
};
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

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** A series' type: its own, else the chart's (`Chart#initSeries`: `options.type || optionsChart.type`). */
function typeOf(config: unknown, item: Item): Fact<string> {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset' ? own : readFact(config, ['chart', 'type'], isString, CHART_TYPE);
}

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
function stackingOf(config: unknown, item: Item, type: string): Fact<Stacking> {
	const at = (path: readonly (string | number)[]): Fact<unknown> => readFact(config, [...path, 'stacking'], isSet);
	const stacking = firstSet([at(item.segments), at(['plotOptions', type]), at(['plotOptions', 'series'])]);
	if (!stacking.known)
		return stacking.reason === 'unset'
			? { known: true, value: 'none', path: stacking.path, source: 'default', pointer: STACKS }
			: stacking;
	if (stacking.value === null || stacking.value === '') return { ...stacking, value: 'none' };
	const mapped = typeof stacking.value === 'string' ? STACKINGS[stacking.value] : undefined;
	// `stream` and `overlap` are not modelled yet.
	return mapped === undefined ? unknown(stacking.path, 'unmodelled') : { ...stacking, value: mapped };
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
		stacking: stackingOf(config, item, type.value)
	};
}

export function seriesOf(config: unknown, item: Item, chart: ChartLayout, color: Fact<string>): SeriesSemantics {
	const type = typeOf(config, item);
	return {
		path: item.path,
		type,
		kind: type.known ? { ...type, value: KINDS[type.value] ?? 'other' } : type,
		name: readFact(config, [...item.segments, 'name'], isString),
		...layoutOf(config, item, type, chart),
		color,
		values: valuesOf(config, item, type)
	};
}
