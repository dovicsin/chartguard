import { type Diagnostic, result, type ValidationResult } from '@chartguard/core';

import type { NormalizedChart } from './chart.js';
import { QUALITY_RULES } from './rules.js';

const QUALITY_SCHEMA_VERSION = 'quality-starter-0.1';

export function review(chart: NormalizedChart, library: string): ValidationResult {
	const diagnostics = QUALITY_RULES.map((rule) => rule(chart)).filter(
		(diagnostic): diagnostic is Diagnostic => diagnostic !== undefined
	);
	return result(library, QUALITY_SCHEMA_VERSION, 'partial', diagnostics);
}
