import type { QualityReport } from '@chartguard/core';
import {
	type AxisSemantics,
	type ChartSemantics,
	type Default,
	type Fact,
	isBoolean,
	isNumber,
	isString,
	type Item,
	itemsAt,
	type Listed,
	readFact,
	readPath,
	review,
	type SeriesKind,
	type SeriesSemantics,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

/** Runtime defaults, each pointing at the line of the pinned highcharts that applies it. */
const DEFAULTS = {
	chartType: { value: 'line', pointer: "highcharts@13.1.1 highcharts.src.js:1191 type: 'line'," },
	titleText: { value: 'Chart title', pointer: "highcharts@13.1.1 highcharts.src.js:5417 text: 'Chart title'," }
} as const satisfies Record<string, Default<unknown>>;
/** A series binds the axis its `yAxis` names by index or id, else the first (`Series#bindAxes`). */
const BIND_AXIS = 'highcharts@13.1.1 highcharts.src.js:33142 if ((seriesOptions[coll] ?? 0) === axis.index ||';

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

/** A series' type: its own, else the chart's (`Chart#initSeries`: `options.type || optionsChart.type`). */
function typeOf(config: unknown, item: Item): Fact<string> {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset' ? own : readFact(config, ['chart', 'type'], isString, DEFAULTS.chartType);
}

const yAxes = (config: unknown): Listed<Item> => itemsAt(config, ['yAxis'], { single: true });

/**
 * The y axis a series is measured on (in Highcharts the value axis, also for horizontal `bar` and
 * inverted charts): the one its `yAxis` names by index or id, else the first. Polar charts and
 * types without these axes are left for CG-05-03.
 */
function valueAxisOf(config: unknown, item: Item, type: Fact<string>): Fact<string> {
	const named = readFact(
		config,
		[...item.segments, 'yAxis'],
		(value): value is number | string => isNumber(value) || isString(value)
	);
	return unmodelledAxis(config, type, named.path) ?? boundAxis(config, named);
}

/** Why a series has no modelled value axis, or undefined for a cartesian type on a flat (not polar) chart. */
function unmodelledAxis(config: unknown, type: Fact<string>, at: string): UnknownFact | undefined {
	if (!type.known) return unknown(at, type.reason);
	if (KINDS[type.value] === 'pie') return unknown(at, 'inapplicable');
	const polar = readFact(config, ['chart', 'polar'], isBoolean);
	const flat = polar.known ? !polar.value : polar.reason === 'unset';
	return KINDS[type.value] !== undefined && flat ? undefined : unknown(at, 'unmodelled');
}

/** The y axis the series' `yAxis` names by index or id, else the first. */
function boundAxis(config: unknown, named: Fact<number | string>): Fact<string> {
	if (!named.known && named.reason !== 'unset') return named;
	const axes = yAxes(config);
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

function seriesOf(config: unknown, item: Item): SeriesSemantics {
	const type = typeOf(config, item);
	return {
		path: item.path,
		type,
		kind: type.known ? { ...type, value: KINDS[type.value] ?? 'other' } : type,
		name: readFact(config, [...item.segments, 'name'], isString),
		valueAxis: valueAxisOf(config, item, type)
	};
}

function axesOf(config: unknown): AxisSemantics[] {
	return (['xAxis', 'yAxis'] as const).flatMap((name) => {
		const axes = itemsAt(config, [name], { single: true });
		if (!axes.known) return [];
		return axes.items.map((axis, index) => ({
			key: `${name}[${String(index)}]`,
			path: axis.path,
			min: readFact(config, [...axis.segments, 'min'], isNumber),
			max: readFact(config, [...axis.segments, 'max'], isNumber),
			title: readFact(config, [...axis.segments, 'title', 'text'], isString)
		}));
	});
}

/** The Highcharts options as library-neutral chart semantics (CG-05-02). */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series']);
	return {
		library: 'highcharts',
		title: {
			text: readFact(config, ['title', 'text'], isString, DEFAULTS.titleText),
			// Highcharts has no switch: a title shows unless its text is empty; not modelled yet.
			shown: unknown('$.title.text', 'unmodelled')
		},
		series: items.known ? { ...items, items: items.items.map((item) => seriesOf(config, item)) } : items,
		axes: axesOf(config)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}
