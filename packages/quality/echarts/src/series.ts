import {
	type CoordinateSystem,
	type Default,
	type Fact,
	isNumber,
	isString,
	type Item,
	type Orientation,
	readFact,
	readPath,
	sameShades,
	type SeriesKind,
	type SeriesSemantics,
	type Stacking,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

import { axisType, referredAxis } from './axes.js';
import { legendHides } from './legend.js';
import { valuesOf } from './values.js';

/** Each cartesian series type defaults to the grid, at the line of its own default options. */
const GRID: Readonly<Record<string, Default<string>>> = {
	line: { value: 'cartesian2d', pointer: "echarts@6.1.0 dist/echarts.js:40938 coordinateSystem: 'cartesian2d'," },
	bar: { value: 'cartesian2d', pointer: "echarts@6.1.0 dist/echarts.js:45641 coordinateSystem: 'cartesian2d'," },
	scatter: { value: 'cartesian2d', pointer: "echarts@6.1.0 dist/echarts.js:48071 coordinateSystem: 'cartesian2d'," },
	effectScatter: {
		value: 'cartesian2d',
		pointer: "echarts@6.1.0 dist/echarts.js:68448 coordinateSystem: 'cartesian2d',"
	}
};
/** A series is stacked with those sharing its `stack`; an empty one does not stack. */
const STACKED = 'echarts@6.1.0 dist/echarts.js:20960 if (stack) {';

const KINDS: Readonly<Record<string, SeriesKind>> = {
	bar: 'bar',
	line: 'line',
	scatter: 'scatter',
	effectScatter: 'scatter',
	pie: 'pie'
};
const SYSTEMS: Readonly<Record<string, CoordinateSystem>> = { cartesian2d: 'cartesian', polar: 'polar' };
const MEASURED = new Set(['value', 'log']);

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** A line series with `areaStyle` draws an area (`var isAreaChart = !areaStyleModel.isEmpty()`, dist/echarts.js:42844; empty is `null`). */
function kindOf(config: unknown, item: Item, type: Fact<string>): Fact<SeriesKind> {
	if (!type.known) return type;
	if (type.value !== 'line') return { ...type, value: KINDS[type.value] ?? 'other' };
	const area = readFact(config, [...item.segments, 'areaStyle'], isSet);
	if (area.known) return area.value === null ? { ...type, value: 'line' } : { ...area, value: 'area' };
	return area.reason === 'unset' ? { ...type, value: 'line' } : area;
}

function systemOf(config: unknown, item: Item, type: string): Fact<CoordinateSystem> {
	const system = readFact(config, [...item.segments, 'coordinateSystem'], isString, GRID[type]);
	if (!system.known) return system;
	const mapped = SYSTEMS[system.value];
	return mapped === undefined ? unknown(system.path, 'unmodelled') : { ...system, value: mapped };
}

function stackingOf(config: unknown, item: Item): Fact<Stacking> {
	const stack = readFact(config, [...item.segments, 'stack'], isSet);
	if (stack.known) return { ...stack, value: stack.value === '' || stack.value === null ? 'none' : 'stacked' };
	return stack.reason === 'unset'
		? { known: true, value: 'none', path: stack.path, source: 'default', pointer: STACKED }
		: stack;
}

type Layout = Pick<SeriesSemantics, 'coordinateSystem' | 'orientation' | 'valueAxis' | 'stacking'>;

const none = (item: Item, reason: UnknownFact['reason']): Layout => ({
	coordinateSystem: unknown(`${item.path}.coordinateSystem`, reason),
	orientation: unknown(item.path, reason),
	valueAxis: unknown(`${item.path}.yAxisIndex`, reason),
	stacking: unknown(`${item.path}.stack`, reason)
});

/** A series whose axis cannot be read: neither its orientation nor its value axis is known. */
const unread = (item: Item, axis: UnknownFact): Pick<Layout, 'orientation' | 'valueAxis'> => ({
	orientation: unknown(item.path, axis.reason),
	valueAxis: unknown(axis.path, axis.reason)
});

/**
 * On a grid, the axis that measures (`value`, `log`) while the other does not carries the values: the
 * y axis for vertical bars and lines, the x axis for horizontal ones (scatter measures on both; y is
 * its value axis). Two category axes, or two measuring ones for a bar, are not modelled.
 */
function gridLayout(config: unknown, item: Item, type: string): Pick<Layout, 'orientation' | 'valueAxis'> {
	const [y, x] = [referredAxis(config, item, 'y'), referredAxis(config, item, 'x')];
	if (!y.known) return unread(item, y);
	if (!x.known) return unread(item, x);
	const [yType, xType] = [axisType(config, 'y', y.value), axisType(config, 'x', x.value)];
	if (!yType.known || !xType.known)
		return { orientation: unknown(item.path, 'unmodelled'), valueAxis: unknown(y.path, 'unmodelled') };
	const [yMeasures, xMeasures] = [MEASURED.has(yType.value), MEASURED.has(xType.value)];
	if (yMeasures && (!xMeasures || KINDS[type] === 'scatter'))
		return { orientation: { ...yType, value: 'vertical' }, valueAxis: { ...y, value: `yAxis[${String(y.value)}]` } };
	if (xMeasures && !yMeasures)
		return {
			orientation: { ...xType, value: 'horizontal' satisfies Orientation },
			valueAxis: { ...x, value: `xAxis[${String(x.value)}]` }
		};
	return { orientation: unknown(item.path, 'unmodelled'), valueAxis: unknown(y.path, 'unmodelled') };
}

function layoutOf(config: unknown, item: Item, type: Fact<string>): Layout {
	if (!type.known) return none(item, type.reason);
	if (KINDS[type.value] === 'pie') return none(item, 'inapplicable');
	if (GRID[type.value] === undefined) return none(item, 'unmodelled');
	const coordinateSystem = systemOf(config, item, type.value);
	const stacking = stackingOf(config, item);
	if (!coordinateSystem.known || coordinateSystem.value !== 'cartesian')
		// Polar bars and lines: which of radius and angle measures is not modelled yet.
		return {
			...none(item, coordinateSystem.known ? 'unmodelled' : coordinateSystem.reason),
			coordinateSystem,
			stacking
		};
	return { coordinateSystem, stacking, ...gridLayout(config, item, type.value) };
}

/** Bars grow from their value axis's `startValue`, else zero (`scale.getDefaultStartValue ? … : 0`). */
const START: Default<number> = {
	value: 0,
	pointer:
		'echarts@6.1.0 dist/echarts.js:35171 startValue = scale.getDefaultStartValue ? scale.getDefaultStartValue() : 0;'
};
const AXIS_KEY = /^([xy])Axis\[(\d+)\]$/u;
const isList = (config: unknown, direction: string): boolean => Array.isArray(readPath(config, [`${direction}Axis`]));

/** The `startValue` of the value axis `key` (`yAxis[0]`); log axes start from 1 (not modelled). */
function startOf(config: unknown, key: string, at: string): Fact<number> {
	const [, direction, index] = AXIS_KEY.exec(key) ?? [];
	if (direction === undefined || index === undefined) return unknown(at, 'unmodelled');
	const type = axisType(config, direction as 'x' | 'y', Number(index));
	if (!type.known || type.value !== 'value') return unknown(at, type.known ? 'inapplicable' : type.reason);
	return readFact(
		config,
		[`${direction}Axis`, ...(isList(config, direction) ? [Number(index)] : []), 'startValue'],
		isNumber,
		START
	);
}

/** A bar's base: the `startValue` of the value axis it is measured on. */
function baseOf(config: unknown, item: Item, kind: Fact<SeriesKind>, valueAxis: Fact<string>): Fact<number> {
	const at = `${item.path}.base`;
	if (!kind.known || kind.value !== 'bar') return unknown(at, kind.known ? 'inapplicable' : kind.reason);
	return valueAxis.known ? startOf(config, valueAxis.value, at) : unknown(at, valueAxis.reason);
}

export function seriesOf(config: unknown, item: Item, color: Fact<string>): SeriesSemantics {
	const type = readFact(config, [...item.segments, 'type'], isString);
	const kind = kindOf(config, item, type);
	const layout = layoutOf(config, item, type);
	const name = readFact(config, [...item.segments, 'name'], isString);
	const hidden = legendHides(config, item, name);
	return {
		path: item.path,
		type,
		kind,
		name,
		...layout,
		base: baseOf(config, item, kind, layout.valueAxis),
		color,
		shades: sameShades(color),
		values: hidden === undefined ? valuesOf(config, item) : unknown(`${item.path}.data`, hidden)
	};
}
