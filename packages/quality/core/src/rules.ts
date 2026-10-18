import type { Diagnostic } from '@chartguard/core';

import type { NormalizedChart } from './chart.js';

type QualityRule = (chart: NormalizedChart) => Diagnostic | undefined;

/** Findings point at the config path the fact was read from, never at a library-specific guess. */
const barBaseline: QualityRule = ({ kind, yMin }) => {
	if (kind?.value !== 'bar' || yMin === undefined || yMin.value === 0) return undefined;
	return {
		code: 'VIS_BAR_BASELINE',
		severity: 'warning',
		path: yMin.path,
		message: 'Bar chart uses a non-zero numeric baseline; verify that the comparison is not misleading.',
		confidence: 'inferred',
		ruleId: 'bar-baseline'
	};
};

const emptyTitle: QualityRule = ({ title }) => {
	if (title?.value.trim() !== '') return undefined;
	return {
		code: 'VIS_EMPTY_TITLE',
		severity: 'info',
		path: title.path,
		message: 'Chart title is empty; ensure context is supplied nearby.',
		confidence: 'inferred',
		ruleId: 'empty-title'
	};
};

export const QUALITY_RULES: readonly QualityRule[] = [barBaseline, emptyTitle];
