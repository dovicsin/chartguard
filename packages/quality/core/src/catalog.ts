import type { Diagnostic } from '@chartguard/core';

import type { ChartSemantics } from './chart.js';

/** A published source a rule rests on. */
export interface Evidence {
	readonly authors: string;
	readonly title: string;
	readonly venue: string;
	readonly year: number;
}

/**
 * What a rule is and why (CG-05-04): its finding code and severity (advisory only: never an error),
 * the reasoning, the sources it rests on, and the cases where it is knowingly wrong or silent.
 */
export interface RuleInfo {
	readonly id: string;
	readonly code: string;
	readonly severity: 'warning' | 'info';
	readonly title: string;
	readonly rationale: string;
	readonly evidence: readonly Evidence[];
	/** Where the rule can be wrong or says nothing: the documented false-positive and false-negative limits. */
	readonly limits: readonly string[];
}

export interface QualityRule extends RuleInfo {
	readonly check: (chart: ChartSemantics) => readonly Diagnostic[];
}

/** Reports a finding of the rule at `path`. */
export type Report = (path: string, message: string) => Diagnostic;

/** A rule from its catalog entry and its check, which reports through `report` (code, severity and id come from `info`). */
export function rule(
	info: RuleInfo,
	check: (chart: ChartSemantics, report: Report) => readonly Diagnostic[]
): QualityRule {
	return { ...info, check: (chart) => check(chart, (path, message) => finding(info, path, message)) };
}

/** A finding of a rule at `path`: inferred, as every quality finding (a chart's intent is not in its config). */
function finding({ id, code, severity }: RuleInfo, path: string, message: string): Diagnostic {
	return { code, severity, path, message, confidence: 'inferred', ruleId: id };
}

/** Sources several rules share. */
export const SOURCES = {
	pandey2015: {
		authors: 'Pandey, Rall, Satterthwaite, Nov, Bertini',
		title: 'How Deceptive are Deceptive Visualizations? An Empirical Analysis of Common Distortion Techniques',
		venue: 'Proceedings of CHI 2015',
		year: 2015
	},
	correll2020: {
		authors: 'Correll, Bertini, Franconeri',
		title: 'Truncating the Y-Axis: Threat or Menace?',
		venue: 'Proceedings of CHI 2020',
		year: 2020
	},
	cleveland1984: {
		authors: 'Cleveland, McGill',
		title: 'Graphical Perception: Theory, Experimentation, and Application to the Development of Graphical Methods',
		venue: 'Journal of the American Statistical Association 79(387)',
		year: 1984
	},
	isenberg2011: {
		authors: 'Isenberg, Bezerianos, Dragicevic, Fekete',
		title: 'A Study on Dual-Scale Data Charts',
		venue: 'IEEE Transactions on Visualization and Computer Graphics 17(12)',
		year: 2011
	},
	wcag22: {
		authors: 'W3C',
		title: 'Web Content Accessibility Guidelines (WCAG) 2.2, Success Criterion 1.1.1 Non-text Content',
		venue: 'W3C Recommendation',
		year: 2023
	}
} as const satisfies Record<string, Evidence>;
