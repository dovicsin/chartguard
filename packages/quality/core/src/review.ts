import type { QualityReport } from '@chartguard/core';

import type { ChartSemantics } from './chart.js';
import { QUALITY_RULES } from './rules.js';

const RULES_VERSION = 'quality-0.3';

/** Advisory only: the report has no verdict, and a finding never makes a config invalid. */
export function review(chart: ChartSemantics): QualityReport {
	return {
		library: chart.library,
		rulesVersion: RULES_VERSION,
		diagnostics: QUALITY_RULES.flatMap((rule) => rule(chart))
	};
}
