import {
	type CoordinateSystem,
	type Default,
	type Fact,
	firstSet,
	isString,
	type Item,
	type Orientation,
	readFact,
	type SeriesKind,
	type SeriesSemantics,
	type Stacking,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

import { type Axis, type DatasetScales, scaleOf, type Scales } from './scales.js';

/** Runtime facts, each pointing at the line of the pinned chart.js that applies it. */
export const INDEX_AXIS: Default<string> = {
	value: 'x',
	pointer:
		"chart.js@4.5.1 dist/chart.js:5234 return datasetOptions.indexAxis || options.indexAxis || datasetDefaults.indexAxis || 'x';"
};
const FILL: Default<unknown> = { value: false, pointer: 'chart.js@4.5.1 dist/chart.js:6955 fill: false,' };
/** Stacked when the value scale says so, or when it says nothing and the dataset has a `stack`. */
const STACKED = 'chart.js@4.5.1 dist/chart.js:478 return stacked || stacked === undefined && meta.stack !== undefined;';

const CARTESIAN: Readonly<Record<string, SeriesKind>> = {
	bar: 'bar',
	line: 'line',
	scatter: 'scatter',
	bubble: 'scatter'
};
const PIE = new Set(['pie', 'doughnut']);
/** Drawn on the radial scale `r`. */
const RADIAL = new Set(['radar', 'polarArea']);

/** Any value the config sets, except one decided at runtime. */
const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** A dataset's type: its own, else the chart's (`const type = dataset.type || config.type`, dist/chart.js:5317). */
function typeOf(config: unknown, item: Item): Fact<string> {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset' ? own : readFact(config, ['type'], isString);
}

/**
 * A line dataset with a `fill` other than `false` draws an area. `fill` resolves through the dataset,
 * the options for line datasets and those for line elements; the line element default is `false`.
 * (Drawing it needs the Filler plugin; the config engine reports an unregistered one.)
 */
function kindOf(config: unknown, item: Item, type: Fact<string>): Fact<SeriesKind> {
	if (!type.known) return type;
	if (type.value !== 'line')
		return { ...type, value: CARTESIAN[type.value] ?? (PIE.has(type.value) ? 'pie' : 'other') };
	const fill = firstSet(
		[
			readFact(config, [...item.segments, 'fill'], isSet),
			readFact(config, ['options', 'datasets', 'line', 'fill'], isSet),
			readFact(config, ['options', 'elements', 'line', 'fill'], isSet)
		],
		FILL
	);
	if (!fill.known) return fill;
	return fill.value === false ? { ...type, value: 'line' } : { ...fill, value: 'area' };
}

/** The index axis: the dataset's, the one for its type, the chart's, else `x`. */
function indexAxisOf(config: unknown, item: Item, type: string): Fact<string> {
	return firstSet(
		[
			readFact(config, [...item.segments, 'indexAxis'], isString),
			readFact(config, ['options', 'datasets', type, 'indexAxis'], isString),
			readFact(config, ['options', 'indexAxis'], isString)
		],
		INDEX_AXIS
	);
}

function orientationOf(index: Fact<string>): Fact<Orientation> {
	if (!index.known) return index;
	if (index.value === 'x') return { ...index, value: 'vertical' };
	return index.value === 'y' ? { ...index, value: 'horizontal' } : unknown(index.path, 'unmodelled');
}

/** The axes a built-in type adds a scale on; undefined for a type that is not built in. */
function axesOfType(type: string): readonly Axis[] | undefined {
	if (PIE.has(type)) return [];
	if (RADIAL.has(type)) return ['r'];
	return CARTESIAN[type] === undefined ? undefined : ['x', 'y'];
}

/**
 * The scales a dataset's type adds (`const id = dataset[axis + 'AxisID'] || axis`, dist/chart.js:5323):
 * one on x and one on y for cartesian types, one on r for radial ones, none for pie. Undefined when
 * its type or a scale id cannot be read, or the type is not built in (it may add others).
 */
export function addedScales(config: unknown): DatasetScales {
	return (item) => {
		const type = typeOf(config, item);
		if (!type.known) return undefined;
		const axes = axesOfType(type.value);
		if (axes === undefined) return undefined;
		const ids = axes.map((axis) => readFact(config, [...item.segments, `${axis}AxisID`], isString));
		if (ids.some((id) => !id.known && id.reason !== 'unset')) return undefined;
		return axes.map((axis, index) => {
			const id = ids[index];
			return { id: id?.known === true && id.value !== '' ? id.value : axis, axis };
		});
	};
}

/** Whether the dataset's values are stacked, from its value scale's `stacked`, else its own `stack`. */
function stackingOf(config: unknown, item: Item, scale: Fact<string>): Fact<Stacking> {
	if (!scale.known) return unknown(`${item.path}.stack`, scale.reason);
	const stacked = readFact(config, ['options', 'scales', scale.value, 'stacked'], isSet);
	if (stacked.known) return { ...stacked, value: stacked.value === false ? 'none' : 'stacked' };
	if (stacked.reason !== 'unset') return stacked;
	const stack = readFact(config, [...item.segments, 'stack'], isSet);
	if (stack.known) return { ...stack, value: 'stacked' };
	return stack.reason === 'unset'
		? { known: true, value: 'none', path: stack.path, source: 'default', pointer: STACKED }
		: stack;
}

type Layout = Pick<SeriesSemantics, 'coordinateSystem' | 'orientation' | 'valueAxis' | 'stacking'>;

const none = (item: Item, reason: UnknownFact['reason']): Layout => ({
	coordinateSystem: unknown(item.path, reason),
	orientation: unknown(`${item.path}.indexAxis`, reason),
	valueAxis: unknown(`${item.path}.yAxisID`, reason),
	stacking: unknown(`${item.path}.stack`, reason)
});

function cartesianLayout(config: unknown, item: Item, type: Fact<string> & { known: true }, scales: Scales): Layout {
	const orientation = orientationOf(indexAxisOf(config, item, type.value));
	const coordinateSystem: Fact<CoordinateSystem> = { ...type, value: 'cartesian' };
	if (!orientation.known) return { ...none(item, orientation.reason), coordinateSystem, orientation };
	// The value axis is the one that is not the index axis (`axis = indexAxis === 'x' ? 'y' : 'x'`, dist/chart.js:5241).
	const valueAxis = scaleOf(config, item, orientation.value === 'vertical' ? 'y' : 'x', scales);
	return { coordinateSystem, orientation, valueAxis, stacking: stackingOf(config, item, valueAxis) };
}

function layoutOf(config: unknown, item: Item, type: Fact<string>, scales: Scales): Layout {
	if (!type.known) return none(item, type.reason);
	if (PIE.has(type.value)) return none(item, 'inapplicable');
	if (RADIAL.has(type.value))
		return {
			...none(item, 'inapplicable'),
			coordinateSystem: { ...type, value: 'polar' },
			valueAxis: scaleOf(config, item, 'r', scales)
		};
	if (CARTESIAN[type.value] === undefined) return none(item, 'unmodelled');
	return cartesianLayout(config, item, type, scales);
}

export function seriesOf(config: unknown, item: Item, scales: Scales): SeriesSemantics {
	const type = typeOf(config, item);
	return {
		path: item.path,
		type,
		kind: kindOf(config, item, type),
		name: readFact(config, [...item.segments, 'label'], isString),
		...layoutOf(config, item, type, scales)
	};
}
