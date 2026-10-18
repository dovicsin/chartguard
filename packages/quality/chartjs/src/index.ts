import type { QualityReport } from '@chartguard/core';
import { type NormalizedChart, numberAt, review, stringAt } from '@chartguard/quality-core';

export function normalize(config: unknown): NormalizedChart {
	return {
		kind: stringAt(config, ['type']),
		yMin: numberAt(config, ['options', 'scales', 'y', 'min']),
		title: stringAt(config, ['options', 'plugins', 'title', 'text'])
	};
}

export function analyze(config: unknown): QualityReport {
	return review(normalize(config), 'chartjs');
}
