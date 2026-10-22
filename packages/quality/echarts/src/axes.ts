import {
	type AxisSemantics,
	type Default,
	type Fact,
	formatPath,
	isNumber,
	isString,
	type Item,
	itemsAt,
	type Listed,
	readFact,
	readPath,
	unknown
} from '@chartguard/quality-core';

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

export function axesOf(config: unknown): AxisSemantics[] {
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
