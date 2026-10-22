import type { Diagnostic } from '@chartguard/core';

import type { AxisSemantics, ChartSemantics } from './chart.js';
import { valueOf } from './facts.js';

type QualityRule = (chart: ChartSemantics) => readonly Diagnostic[];

/** The axes bar series are measured on, each once. */
function barValueAxes({ series, axes }: ChartSemantics): AxisSemantics[] {
	if (!series.known) return [];
	const keys = new Set(
		series.items.filter(({ kind }) => valueOf(kind) === 'bar').flatMap(({ valueAxis }) => valueOf(valueAxis) ?? [])
	);
	return axes.filter(({ key }) => keys.has(key));
}

/** Findings point at the config path the fact was read from, never at a library-specific guess (B3). */
const barBaseline: QualityRule = (chart) =>
	barValueAxes(chart).flatMap(({ min }) => {
		if (!min.known || min.source !== 'config' || min.value === 0) return [];
		return [
			{
				code: 'VIS_BAR_BASELINE',
				severity: 'warning',
				path: min.path,
				message: 'Bar chart uses a non-zero numeric baseline; verify that the comparison is not misleading.',
				confidence: 'inferred',
				ruleId: 'bar-baseline'
			}
		];
	});

/** A title the config sets to blank text, unless it is known to be hidden. */
const emptyTitle: QualityRule = ({ title: { text, shown } }) => {
	if (!text.known || text.source !== 'config' || text.value.trim() !== '' || valueOf(shown) === false) return [];
	return [
		{
			code: 'VIS_EMPTY_TITLE',
			severity: 'info',
			path: text.path,
			message: 'Chart title is empty; ensure context is supplied nearby.',
			confidence: 'inferred',
			ruleId: 'empty-title'
		}
	];
};

export const QUALITY_RULES: readonly QualityRule[] = [barBaseline, emptyTitle];
