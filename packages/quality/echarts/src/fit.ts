import {
	dataRange,
	type Default,
	type Fact,
	holds,
	isBoolean,
	isNumber,
	type Item,
	type Listed,
	readFact,
	type SeriesSemantics,
	unknown,
	type UnknownReason,
	type ZeroFit,
	zeroFit
} from '@chartguard/quality-core';

/** The round nice numbers, each for the fractions below its bound. */
const ROUND: readonly (readonly [number, number])[] = [
	[1.5, 1],
	[2.5, 2],
	[4, 3],
	[7, 5]
];

/** `nice(val, true)` (echarts@6.1.0 dist/echarts.js:8085): the round nice numbers are 1, 2, 3, 5 and 10. */
function nice(value: number): number {
	let exponent = Math.floor(Math.log(value) / Math.LN10);
	if (value / 10 ** exponent >= 10) exponent += 1;
	const fraction = value / 10 ** exponent;
	const rounded = ROUND.find(([below]) => fraction < below)?.[1] ?? 10;
	return Number((rounded * 10 ** exponent).toFixed(Math.min(Math.max(0, -exponent), 100)));
}

/** `intervalScaleEnsureValidExtent` (:33275): a single value is widened by half of it each way (zero to `[0, 1]`). */
function widened([min, max]: readonly [number, number]): readonly [number, number] {
	if (min !== max) return [min, max];
	return min === 0 ? [0, 1] : [min - Math.abs(min) / 2, max + Math.abs(min) / 2];
}

/** Axis options that bound, pad or step the range: any of them set leaves the fit not modelled. */
const UNMODELLED = [
	'min',
	'max',
	'startValue',
	'dataMin',
	'dataMax',
	'boundaryGap',
	'interval',
	'minInterval',
	'maxInterval',
	'alignTicks'
];
const SPLIT_NUMBER: Default<number> = {
	value: 5,
	pointer: 'echarts@6.1.0 dist/echarts.js:35619 var splitNumber = ensureValidSplitNumber(opt.splitNumber, 5);'
};
/** Rounding near a tick: closer than this to the boundary, the floating-point result is not claimed. */
const MARGIN = 1e-9;

/** The interval the axis splits its span by: `round(max(splitNumber || 5, 1))` (`ensureValidSplitNumber`, :33321). */
function splitsOf(config: unknown, segments: readonly (string | number)[]): Fact<number> {
	const split = readFact(config, [...segments, 'splitNumber'], isNumber, SPLIT_NUMBER);
	if (!split.known) return split;
	return { ...split, value: Math.round(Math.max(split.value === 0 ? SPLIT_NUMBER.value : split.value, 1)) };
}

/** The axis whose fit is read: where it is, its key and its type. */
export interface FittedAxis {
	readonly item: Item;
	readonly key: string;
	readonly type: Fact<string>;
}

/**
 * Where zero is in the range a value axis with `scale: true` fits to the data: the data extent, made
 * nice outwards by the interval `nice(span / splitNumber)` (`calcNiceForIntervalOrLogScale`, :35575).
 * It does not depend on the size. A `dataZoom` and the options in `UNMODELLED` are not modelled.
 */
/** Why the axis's fit is not modelled (or does not apply); undefined when it is. */
function notFitted(config: unknown, { item, type }: FittedAxis, asked: boolean): UnknownReason | undefined {
	if (!asked) return 'inapplicable';
	if (!type.known) return type.reason;
	if (type.value !== 'value') return 'inapplicable';
	const unmodelled = holds(config, ['dataZoom']) || UNMODELLED.some((name) => holds(config, [...item.segments, name]));
	return unmodelled ? 'unmodelled' : undefined;
}

export function fitOf(config: unknown, axis: FittedAxis, series: Listed<SeriesSemantics>): Fact<ZeroFit> {
	const asked = readFact(config, [...axis.item.segments, 'scale'], isBoolean);
	if (!asked.known) return asked;
	const reason = notFitted(config, axis, asked.value);
	if (reason !== undefined) return unknown(asked.path, reason);
	const splits = splitsOf(config, axis.item.segments);
	if (!splits.known) return unknown(asked.path, splits.reason);
	const data = dataRange(series, axis.key, asked.path);
	if (!data.known) return data;
	const [min, max] = widened(data.value);
	const interval = nice((max - min) / splits.value);
	const [low, high] = [min / interval, max / interval];
	if (Math.abs(low - 1) < MARGIN || Math.abs(high + 1) < MARGIN) return unknown(asked.path, 'unmodelled');
	return zeroFit([[Math.floor(low) * interval, Math.ceil(high) * interval]], asked);
}
