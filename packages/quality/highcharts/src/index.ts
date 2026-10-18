import type { QualityReport } from '@chartguard/core';
import { type NormalizedChart, numberAt, review, stringAt } from '@chartguard/quality-core';

/** An array-valued `yAxis` stays unknown: no axis is guessed. */
export function normalize(config: unknown): NormalizedChart {
	return {
		kind: stringAt(config, ['chart', 'type']),
		yMin: numberAt(config, ['yAxis', 'min']),
		title: stringAt(config, ['title', 'text'])
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config), 'highcharts');
}
