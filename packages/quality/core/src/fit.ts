import type { SeriesKind, SeriesSemantics, ZeroFit } from './chart.js';
import { type Fact, type KnownFact, type Listed, unknown, type UnknownFact } from './facts.js';

/** Kinds whose values are on their value axis only (pies are on none). */
const ONE_VALUE_AXIS = new Set<SeriesKind>(['bar', 'line', 'area', 'pie']);

/** The smallest and largest value of a range. */
export type ValueRange = readonly [number, number];

/** Whether a series puts its values on `key`; undefined when that is not known. */
function isOn(item: SeriesSemantics, key: string): boolean | undefined {
	if (!item.kind.known || !ONE_VALUE_AXIS.has(item.kind.value)) return undefined;
	if (item.kind.value === 'pie') return false;
	return item.valueAxis.known ? item.valueAxis.value === key : undefined;
}

/** The range of an unstacked series' values; undefined when it has none. */
function rangeOf(item: SeriesSemantics, at: string): ValueRange | undefined | UnknownFact {
	if (!item.stacking.known || item.stacking.value !== 'none') return unknown(at, 'unmodelled');
	if (!item.values.known) return unknown(at, item.values.reason);
	const { min, max } = item.values.value;
	return min === undefined || max === undefined ? undefined : [min.value, max.value];
}

/**
 * The smallest and largest value of the series measured on the axis `key`, as a fitted range starts
 * from them. Unknown when a series could be on it but its axis is not known, when one on it is stacked
 * (or its stacking or values are not known), or when none has a value. A series that measures on both
 * axes (scatter) or whose kind is not known could put values of its other axis on it: not modelled.
 */
export function dataRange(series: Listed<SeriesSemantics>, key: string, at: string): Fact<ValueRange> {
	if (!series.known) return unknown(at, series.reason);
	let range: ValueRange | undefined;
	for (const item of series.items) {
		const on = isOn(item, key);
		if (on === undefined) return unknown(at, 'unmodelled');
		const values = on ? rangeOf(item, at) : undefined;
		if (values !== undefined && 'known' in values) return values;
		if (values !== undefined)
			range = range === undefined ? values : [Math.min(range[0], values[0]), Math.max(range[1], values[1])];
	}
	return range === undefined ? unknown(at, 'unmodelled') : { known: true, value: range, path: at, source: 'config' };
}

/**
 * Where zero is in the ranges a runtime can fit at the sizes it can be drawn at: excluded when every
 * range leaves it out, included when none does, else it depends on the size (`layout`). The fact is at
 * the switch that asks for the fitted range.
 */
export function zeroFit(ranges: readonly ValueRange[], asked: KnownFact<unknown>): Fact<ZeroFit> {
	const excludes = ranges.map(([min, max]) => min > 0 || max < 0);
	if (excludes.length > 0 && excludes.every(Boolean)) return { ...asked, value: 'excluded' };
	if (!excludes.some(Boolean)) return { ...asked, value: 'included' };
	return unknown(asked.path, 'layout');
}
