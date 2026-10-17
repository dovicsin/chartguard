import type { ValidationResult } from '@chartguard/core';
import { asNumber, asString, type NormalizedChart, readPath, review } from '@chartguard/quality-core';

export function normalize(config: unknown): NormalizedChart {
	return {
		kind: asString(readPath(config, ['type'])),
		yMin: asNumber(readPath(config, ['options', 'scales', 'y', 'min']))
	};
}

export function analyze(config: unknown): ValidationResult {
	return review(normalize(config), 'chartjs');
}
