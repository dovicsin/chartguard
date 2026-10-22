import {
	dataRange,
	type Default,
	type Fact,
	formatPath,
	holds,
	isBoolean,
	isNumber,
	isString,
	type Item,
	type Listed,
	readFact,
	type ScaleType,
	type SeriesSemantics,
	unknown,
	type UnknownReason,
	type ZeroFit,
	zeroFit
} from '@chartguard/quality-core';

const NICE = [1, 2, 5];

/** `niceNum` (chart.js@4.5.1 dist/chunks/helpers.dataset.js:301). */
function niceNum(range: number): number {
	const rounded = Math.round(range);
	const near = Math.abs(range - rounded) < range / 1000 ? rounded : range;
	const magnitude = 10 ** Math.floor(Math.log10(near));
	const fraction = near / magnitude;
	return (NICE.find((step) => fraction <= step) ?? 10) * magnitude;
}

/** `_decimalPlaces` (dist/chunks/helpers.dataset.js:364). */
function decimalPlaces(value: number): number {
	let [scale, places] = [1, 0];
	while (Math.round(value * scale) / scale !== value) [scale, places] = [scale * 10, places + 1];
	return places;
}

/**
 * The first and last tick `generateTicks$1` (dist/chart.js:10137) makes from a data range with at
 * most `maxTicks` ticks, with `bounds: 'ticks'` and no step, count, precision or bound set.
 */
function tickRange(min: number, max: number, maxTicks: number): readonly [number, number] {
	const spaces = maxTicks - 1;
	let spacing = niceNum((max - min) / spaces);
	if (spacing < 1e-14) return [min, max];
	if (Math.ceil(max / spacing) - Math.floor(min / spacing) > spaces)
		spacing = niceNum(((Math.ceil(max / spacing) - Math.floor(min / spacing)) * spacing) / spaces);
	const [niceMin, niceMax] = [Math.floor(min / spacing) * spacing, Math.ceil(max / spacing) * spacing];
	const factor = 10 ** Math.max(decimalPlaces(spacing), decimalPlaces(niceMin));
	return [Math.round(niceMin * factor) / factor, Math.round(niceMax * factor) / factor];
}

/**
 * `handleTickRangeOptions` (dist/chart.js:10261) without `beginAtZero`: a single value is widened by
 * 5 % of it (by 1 when it is zero) on both sides.
 */
function widened([min, max]: readonly [number, number]): readonly [number, number] {
	if (min !== max) return [min, max];
	const offset = max === 0 ? 1 : Math.abs(max * 0.05);
	return [min - offset, max + offset];
}

/** Options that change the range or the ticks in ways not modelled: any of them set leaves the fit unknown. */
const UNMODELLED = [
	['min'],
	['max'],
	['suggestedMin'],
	['suggestedMax'],
	['grace'],
	['ticks', 'stepSize'],
	['ticks', 'count'],
	['ticks', 'precision']
];

/** Linear scales place their range on ticks (`bounds: 'ticks'`). */
const BOUNDS: Default<string> = {
	value: 'ticks',
	pointer: "chart.js@4.5.1 dist/chunks/helpers.dataset.js:936 bounds: 'ticks',"
};

/** The most ticks a linear scale makes, at least two (`Math.max(2, maxTicks)`, dist/chart.js:10312). */
const MAX_TICKS: Default<number> = {
	value: 11,
	pointer: 'chart.js@4.5.1 dist/chart.js:10298 maxTicksLimit = maxTicksLimit || 11;'
};

/** The most ticks the scale makes: `maxTicksLimit || 11`, capped; a fractional limit is a count of its own (not modelled). */
function mostTicks(config: unknown, scale: readonly string[]): Fact<number> {
	const limit = readFact(config, [...scale, 'ticks', 'maxTicksLimit'], isNumber, MAX_TICKS);
	if (!limit.known) return limit;
	if (!Number.isInteger(limit.value)) return unknown(limit.path, 'unmodelled');
	return { ...limit, value: Math.max(2, Math.min(MAX_TICKS.value, limit.value === 0 ? MAX_TICKS.value : limit.value)) };
}

/**
 * The ranges a linear value scale with `beginAtZero: false` can take. Its tick limit depends on the
 * scale's length (`computeTickLimit`, :10373), so every limit from 2 to 11 (or `ticks.maxTicksLimit`)
 * is a size the chart can be drawn at; Chart.js widens the range over its layout passes, so the drawn
 * range lies between them. With `bounds: 'data'` the range is the data's.
 */
function ranges(
	config: unknown,
	scale: readonly string[],
	data: readonly [number, number]
): Fact<(readonly [number, number])[]> {
	const at = formatPath(scale);
	const bounds = readFact(config, [...scale, 'bounds'], isString, BOUNDS);
	if (!bounds.known) return bounds;
	const [min, max] = widened(data);
	if (bounds.value === 'data') return { known: true, value: [[min, max]], path: at, source: 'config' };
	if (bounds.value !== 'ticks') return unknown(bounds.path, 'unmodelled');
	const most = mostTicks(config, scale);
	if (!most.known) return most;
	const value = Array.from({ length: most.value - 1 }, (_, index) => tickRange(min, max, index + 2));
	return { known: true, value, path: at, source: 'config' };
}

/**
 * Why the fit of the scale is not modelled: an option in `UNMODELLED`, or a dataset with `hidden`
 * (left out of the range, `getMatchingVisibleMetas`). Undefined when it is modelled.
 */
function unmodelled(config: unknown, scale: readonly string[], datasets: Listed<Item>): UnknownReason | undefined {
	if (UNMODELLED.some((path) => holds(config, [...scale, ...path]))) return 'unmodelled';
	if (!datasets.known) return datasets.reason;
	return datasets.items.some(({ segments }) => holds(config, [...segments, 'hidden'])) ? 'unmodelled' : undefined;
}

/**
 * Where zero is in the range a linear value scale fits to the data when its `beginAtZero` is `false`
 * (bar charts set it `true` for their value scale). Hidden datasets and the options in `UNMODELLED`
 * are not modelled.
 */
export function fitOf(
	config: unknown,
	key: string,
	type: Fact<ScaleType>,
	{ series, datasets }: { series: Listed<SeriesSemantics>; datasets: Listed<Item> }
): Fact<ZeroFit> {
	const scale = ['options', 'scales', key];
	const asked = readFact(config, [...scale, 'beginAtZero'], isBoolean);
	if (!asked.known) return asked;
	if (asked.value) return unknown(asked.path, 'inapplicable');
	if (!type.known || type.value !== 'linear') return unknown(asked.path, type.known ? 'inapplicable' : type.reason);
	const reason = unmodelled(config, scale, datasets);
	if (reason !== undefined) return unknown(asked.path, reason);
	const data = dataRange(series, key, asked.path);
	if (!data.known) return data;
	const fitted = ranges(config, scale, data.value);
	return fitted.known ? zeroFit(fitted.value, asked) : fitted;
}
