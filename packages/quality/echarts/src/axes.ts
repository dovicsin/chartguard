import {
	type AxisSemantics,
	type Default,
	defaulted,
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
	type ScaleType,
	type SeriesSemantics,
	unknown
} from '@chartguard/quality-core';

import { fitOf } from './fit.js';

export type Direction = 'x' | 'y';

/** A series that names no axis is on the first one (`useDefault`). */
const FIRST_AXIS: Default<number> = {
	value: 0,
	pointer:
		'echarts@6.1.0 dist/echarts.js:8912 result.models = opt.useDefault && (firstCmpt = ecModel.getComponent(mainType)) ? [firstCmpt] : [];'
};
const AXIS_TYPE = "echarts@6.1.0 dist/echarts.js:48731 return option.type || (option.data ? 'category' : 'value');";

const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** The axes of one direction (`yAxis: {…}` or `yAxis: [...]`), keyed `yAxis[i]`. */
function axisItems(config: unknown, direction: Direction): Listed<Item> {
	return itemsAt(config, [`${direction}Axis`], { single: true });
}

/** The axis a series refers to in one direction: by `yAxisIndex`, by `yAxisId`, else the first. */
export function referredAxis(config: unknown, item: Item, direction: Direction): Fact<number> {
	const byIndex = readFact(config, [...item.segments, `${direction}AxisIndex`], isIndex, FIRST_AXIS);
	const byId = readFact(config, [...item.segments, `${direction}AxisId`], isString);
	if (!byId.known) return byId.reason === 'unset' ? byIndex : byId;
	const axes = axisItems(config, direction);
	if (!axes.known) return unknown(byId.path, axes.reason);
	const index = axes.items.findIndex((axis) => readPath(axis.value, ['id']) === byId.value);
	return index < 0 ? unknown(byId.path, 'unmodelled') : { ...byId, value: index };
}

/** The type of an axis as echarts defaults it: its own, else `category` with `data`, else `value`. */
export function axisType(config: unknown, direction: Direction, index: number): Fact<string> {
	const axes = axisItems(config, direction);
	if (!axes.known) return axes;
	const axis = axes.items[index];
	if (axis === undefined) return unknown(formatPath([`${direction}Axis`, index]), 'unmodelled');
	const own = readFact(config, [...axis.segments, 'type'], isString);
	if (own.known || own.reason !== 'unset') return own;
	const value = readPath(config, [...axis.segments, 'data']) === undefined ? 'value' : 'category';
	return { known: true, value, path: own.path, source: 'default', pointer: AXIS_TYPE };
}

/** An axis is shown, and its name empty, unless set. */
const SHOWN: Default<boolean> = { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:48470 show: true,' };
const NAME: Default<string> = { value: '', pointer: "echarts@6.1.0 dist/echarts.js:48476 name: ''," };
const INVERSE: Default<boolean> = { value: false, pointer: 'echarts@6.1.0 dist/echarts.js:48474 inverse: false,' };
const SCALE_TYPES: Readonly<Record<string, ScaleType>> = {
	value: 'linear',
	log: 'log',
	category: 'category',
	time: 'time'
};

/** A number, or `dataMin`/`dataMax`: the axis starts (or ends) at the data. A function decides at runtime. */
const isBound = (value: unknown): value is number | string =>
	isNumber(value) || value === 'dataMin' || value === 'dataMax';
function boundOf(config: unknown, path: readonly (string | number)[]): Fact<number | 'data'> {
	const bound = readFact(config, path, isBound);
	return bound.known && typeof bound.value === 'string' ? { ...bound, value: 'data' } : (bound as Fact<number>);
}

/** A value axis labels its ticks with plain numbers unless `axisLabel.formatter` says otherwise. */
const PLAIN: Default<string> = {
	value: '',
	pointer: 'echarts@6.1.0 dist/echarts.js:34607 return axis.scale.getLabel(tick);'
};
const VALUE = '{value}';

/**
 * The unit of a value axis's labels: a string formatter is a template whose first `{value}` is replaced
 * by the number (`labelFormatter.replace('{value}', …)`, dist/echarts.js:34578), so the rest is the unit;
 * one without `{value}` shows the same text at every tick (not modelled). A function decides at runtime.
 */
function unitOf(config: unknown, segments: readonly (string | number)[], type: Fact<string>): Fact<string> {
	const formatter = readFact(config, [...segments, 'axisLabel', 'formatter'], isString);
	if (!formatter.known)
		return formatter.reason === 'unset' && type.known && type.value === 'value'
			? defaulted(PLAIN, formatter.path)
			: unknown(formatter.path, formatter.reason === 'unset' ? 'unmodelled' : formatter.reason);
	if (!type.known || type.value !== 'value' || !formatter.value.includes(VALUE))
		return unknown(formatter.path, 'unmodelled');
	return { ...formatter, value: formatter.value.replace(VALUE, '').trim() };
}

export function axesOf(config: unknown, series: Listed<SeriesSemantics>): AxisSemantics[] {
	return (['x', 'y'] as const).flatMap((direction) => {
		const axes = axisItems(config, direction);
		if (!axes.known) return [];
		return axes.items.map((axis, index) => {
			const type = axisType(config, direction, index);
			const key = `${direction}Axis[${String(index)}]`;
			return {
				key,
				path: axis.path,
				scale: type.known ? { ...type, value: SCALE_TYPES[type.value] ?? 'other' } : type,
				min: boundOf(config, [...axis.segments, 'min']),
				max: boundOf(config, [...axis.segments, 'max']),
				fit: fitOf(config, { item: axis, key, type }, series),
				unit: unitOf(config, axis.segments, type),
				reversed: readFact(config, [...axis.segments, 'inverse'], isBoolean, INVERSE),
				// The name is drawn with the axis: hidden with it (`show: false`).
				title: {
					text: readFact(config, [...axis.segments, 'name'], isString, NAME),
					shown: readFact(config, [...axis.segments, 'show'], isBoolean, SHOWN)
				}
			};
		});
	});
}
