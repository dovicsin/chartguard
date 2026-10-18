import type { Diagnostic, QualityReport } from '@chartguard/core';

import type { NormalizedChart } from './chart.js';
import { QUALITY_RULES } from './rules.js';

const RULES_VERSION = 'quality-starter-0.2';

/** Advisory only: the report has no verdict, and a finding never makes a config invalid. */
export function review(chart: NormalizedChart, library: string): QualityReport {
	const diagnostics = QUALITY_RULES.map((rule) => rule(chart)).filter(
		(diagnostic): diagnostic is Diagnostic => diagnostic !== undefined
	);
	return { library, rulesVersion: RULES_VERSION, diagnostics };
}
