import type { Diagnostic } from '@chartguard/core';

import type { NormalizedChart } from './chart.js';

type QualityRule = (chart: NormalizedChart) => Diagnostic | undefined;

const barBaseline: QualityRule = (chart) => {
	if (chart.kind !== 'bar' || chart.yMin === undefined || chart.yMin === 0) return undefined;
	return {
		code: 'VIS_BAR_BASELINE',
		severity: 'warning',
		path: '$.yAxis',
		message: 'Bar chart uses a non-zero numeric baseline; verify that the comparison is not misleading.',
		confidence: 'inferred',
		ruleId: 'bar-baseline'
	};
};

const emptyTitle: QualityRule = (chart) => {
	if (chart.title?.trim() !== '') return undefined;
	return {
		code: 'VIS_EMPTY_TITLE',
		severity: 'info',
		path: '$.title',
		message: 'Chart title is empty; ensure context is supplied nearby.',
		confidence: 'inferred'
	};
};

export const QUALITY_RULES: readonly QualityRule[] = [barBaseline, emptyTitle];
