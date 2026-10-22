import type { QualityReport } from '@chartguard/core';
import {
	type AxisSemantics,
	type ChartSemantics,
	type Default,
	type Fact,
	formatPath,
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

/** Runtime defaults, each pointing at the line of the pinned echarts that applies it. */
const DEFAULTS = {
	/** A series that names no axis is on the first one (`useDefault`). */
	firstAxis: {
		value: 0,
		pointer:
			'echarts@6.1.0 dist/echarts.js:8912 result.models = opt.useDefault && (firstCmpt = ecModel.getComponent(mainType)) ? [firstCmpt] : [];'
	},
	titleShown: { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:84452 show: true,' }
} as const satisfies Record<string, Default<unknown>>;
const AXIS_TYPE = "echarts@6.1.0 dist/echarts.js:48731 return option.type || (option.data ? 'category' : 'value');";

const KINDS: Readonly<Record<string, SeriesKind>> = {
	bar: 'bar',
	line: 'line',
	scatter: 'scatter',
	effectScatter: 'scatter',
	pie: 'pie'
};
const CARTESIAN = new Set(['bar', 'line', 'scatter', 'effectScatter']);
const MEASURED = new Set(['value', 'log']);

type Direction = 'x' | 'y';
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** The axes of one direction (`yAxis: {…}` or `yAxis: [...]`), keyed `yAxis[i]`. */
function axisItems(config: unknown, direction: Direction): Listed<Item> {
	return itemsAt(config, [`${direction}Axis`], { single: true });
}

/** The axis a series refers to in one direction: by `yAxisIndex`, by `yAxisId`, else the first. */
function referredAxis(config: unknown, item: Item, direction: Direction): Fact<number> {
	const byIndex = readFact(config, [...item.segments, `${direction}AxisIndex`], isIndex, DEFAULTS.firstAxis);
	const byId = readFact(config, [...item.segments, `${direction}AxisId`], isString);
	if (!byId.known) return byId.reason === 'unset' ? byIndex : byId;
	const axes = axisItems(config, direction);
	if (!axes.known) return unknown(byId.path, axes.reason);
	const index = axes.items.findIndex((axis) => readPath(axis.value, ['id']) === byId.value);
	return index < 0 ? unknown(byId.path, 'unmodelled') : { ...byId, value: index };
}

/** The type of an axis as echarts defaults it: its own, else `category` with `data`, else `value`. */
function axisType(config: unknown, direction: Direction, index: number): Fact<string> {
	const axes = axisItems(config, direction);
	if (!axes.known) return axes;
	const axis = axes.items[index];
	if (axis === undefined) return unknown(formatPath([`${direction}Axis`, index]), 'unmodelled');
	const own = readFact(config, [...axis.segments, 'type'], isString);
	if (own.known || own.reason !== 'unset') return own;
	const data = readPath(config, [...axis.segments, 'data']);
	return {
		known: true,
		value: data === undefined ? 'value' : 'category',
		path: own.path,
		source: 'default',
		pointer: AXIS_TYPE
	};
}

/** Why a series has no modelled value axis, or undefined for a cartesian series on its grid. */
function unmodelledAxis(config: unknown, item: Item, type: Fact<string>, at: string): UnknownFact | undefined {
	if (!type.known) return unknown(at, type.reason);
	if (KINDS[type.value] === 'pie') return unknown(at, 'inapplicable');
	const system = readFact(config, [...item.segments, 'coordinateSystem'], isString);
	return CARTESIAN.has(type.value) && !system.known && system.reason === 'unset'
		? undefined
		: unknown(at, 'unmodelled');
}

/**
 * The y axis `y` when it measures (`value`, `log`) and the series' x axis does not, as in vertical
 * bars and lines (scatter measures on both; y is its value axis). Horizontal layouts are left for CG-05-03.
 */
function verticalAxis(config: unknown, item: Item, y: Fact<number>, type: string): Fact<string> {
	const x = referredAxis(config, item, 'x');
	if (!y.known) return y;
	if (!x.known) return unknown(x.path, x.reason);
	const [yType, xType] = [axisType(config, 'y', y.value), axisType(config, 'x', x.value)];
	if (!yType.known || !xType.known) return unknown(y.path, 'unmodelled');
	const vertical = MEASURED.has(yType.value) && (!MEASURED.has(xType.value) || KINDS[type] === 'scatter');
	return vertical ? { ...y, value: `yAxis[${String(y.value)}]` } : unknown(y.path, 'unmodelled');
}

/** The axis a series' values are measured on. */
function valueAxisOf(config: unknown, item: Item, type: Fact<string>): Fact<string> {
	const y = referredAxis(config, item, 'y');
	const unmodelled = unmodelledAxis(config, item, type, y.path);
	return unmodelled ?? verticalAxis(config, item, y, type.known ? type.value : '');
}

function seriesOf(config: unknown, item: Item): SeriesSemantics {
	const type = readFact(config, [...item.segments, 'type'], isString);
	return {
		path: item.path,
		type,
		kind: type.known ? { ...type, value: KINDS[type.value] ?? 'other' } : type,
		name: readFact(config, [...item.segments, 'name'], isString),
		valueAxis: valueAxisOf(config, item, type)
	};
}

function axesOf(config: unknown): AxisSemantics[] {
	return (['x', 'y'] as const).flatMap((direction) => {
		const axes = axisItems(config, direction);
		if (!axes.known) return [];
		return axes.items.map((axis, index) => ({
			key: `${direction}Axis[${String(index)}]`,
			path: axis.path,
			// `dataMin` and functions are baselines too; they are read in CG-05-04.
			min: readFact(config, [...axis.segments, 'min'], isNumber),
			max: readFact(config, [...axis.segments, 'max'], isNumber),
			title: readFact(config, [...axis.segments, 'name'], isString)
		}));
	});
}

/** The ECharts option as library-neutral chart semantics (CG-05-02). Several titles stay unknown: none is guessed. */
export function normalize(config: unknown): ChartSemantics {
	const items = itemsAt(config, ['series'], { single: true });
	const several = Array.isArray(readPath(config, ['title']));
	return {
		library: 'echarts',
		title: {
			text: several ? unknown('$.title', 'unmodelled') : readFact(config, ['title', 'text'], isString),
			shown: several
				? unknown('$.title', 'unmodelled')
				: readFact(config, ['title', 'show'], isBoolean, DEFAULTS.titleShown)
		},
		series: items.known ? { ...items, items: items.items.map((item) => seriesOf(config, item)) } : items,
		axes: axesOf(config)
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config));
}
