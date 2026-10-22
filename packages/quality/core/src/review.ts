import type { QualityReport } from '@chartguard/core';

import type { RuleInfo } from './catalog.js';
import type { ChartSemantics } from './chart.js';
import { QUALITY_RULES } from './rules.js';

const RULES_VERSION = 'quality-0.5';

/** The rule catalog: what each rule reports, why, on which sources, and where it is knowingly wrong. */
export const RULE_CATALOG: readonly RuleInfo[] = QUALITY_RULES.map(({ check: _check, ...info }) => info);

/** Advisory only: the report has no verdict, and a finding never makes a config invalid. */
export function review(chart: ChartSemantics): QualityReport {
	return {
		library: chart.library,
		rulesVersion: RULES_VERSION,
		diagnostics: QUALITY_RULES.flatMap((rule) => rule.check(chart))
	};
}
