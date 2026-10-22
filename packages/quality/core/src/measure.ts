import type { AxisSemantics, ChartSemantics, SeriesKind, SeriesSemantics } from './chart.js';
import { type Fact, valueOf } from './facts.js';

/** Each axis that a series of one of `kinds` is known to be measured on, once, with the first such series. */
export function measuredAxes(
	{ series, axes }: ChartSemantics,
	kinds: readonly SeriesKind[]
): { axis: AxisSemantics; by: SeriesSemantics }[] {
	if (!series.known) return [];
	const found = new Map<string, { axis: AxisSemantics; by: SeriesSemantics }>();
	for (const item of series.items) {
		const [kind, key] = [valueOf(item.kind), valueOf(item.valueAxis)];
		const axis = axes.find((candidate) => candidate.key === key);
		if (kind !== undefined && kinds.includes(kind) && axis !== undefined && !found.has(axis.key))
			found.set(axis.key, { axis, by: item });
	}
	return [...found.values()];
}

/** A fact the config sets (rules about an author's choice never fire on a runtime default). */
export const configured = <T>(fact: Fact<T>): T | undefined =>
	fact.known && fact.source === 'config' ? fact.value : undefined;

export const CARTESIAN: readonly SeriesKind[] = ['bar', 'line', 'area', 'scatter'];
