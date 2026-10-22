import { type Diagnostic, pathSegments, type QualityReport, type Suppression } from '@chartguard/core';

import type { QualityRule, RuleInfo } from './catalog.js';
import type { ChartSemantics } from './chart.js';
import { withContext } from './context.js';
import { QUALITY_RULES } from './rules.js';
import { checkQualityOptions, type QualityOptions, type Settings } from './settings.js';

const RULES_VERSION = 'quality-0.6';

/** The rule catalog: what each rule reports, why, on which sources, and where it is knowingly wrong. */
export const RULE_CATALOG: readonly RuleInfo[] = QUALITY_RULES.map(({ check: _check, ...info }) => info);

const RULE_IDS = QUALITY_RULES.map(({ id }) => id);

/**
 * Checks options for `review` and the adapters' `analyze`: throws `QualityOptionsError` listing every
 * problem (an unknown rule id or context fact, a level other than `off`, `info`, `warning`, an ignore
 * without a path or a reason, a colour that is not opaque hex or `rgb()`, a getter).
 */
export function assertQualityOptions(value: unknown): asserts value is QualityOptions {
	checkQualityOptions(value, RULE_IDS);
}

/** Whether `path` is `within` or inside it, segment by segment (never by text: `$.a1` is not inside `$.a`). */
function inside(path: string, within: string): boolean {
	const [segments, prefix] = [pathSegments(path), pathSegments(within)];
	if (segments === undefined || prefix === undefined || prefix.length > segments.length) return false;
	return prefix.every((segment, index) => segments[index] === segment);
}

/** Why a finding is not reported: the context meets the rule's concern, or a setting ignores it there. */
function suppression(rule: QualityRule, diagnostic: Diagnostic, settings: Settings): Suppression | undefined {
	const met = rule.context.find(({ fact, effect }) => effect === 'satisfies' && settings.context[fact] === true);
	if (met !== undefined) return { diagnostic, by: 'context', reason: `context.${met.fact}: ${met.note}` };
	const ignored = settings.ignores.get(rule.id)?.find(({ path }) => inside(diagnostic.path, path));
	return ignored === undefined ? undefined : { diagnostic, by: 'setting', reason: ignored.reason };
}

/**
 * The rules' findings on the chart, as the caller's options shape them (CG-05-05): a rule `off` does
 * not run; a level sets the severity of its findings; a finding the context meets, or a setting
 * ignores at its path, is kept in `suppressed` with why. Advisory only: no verdict, never an error.
 */
export function review(chart: ChartSemantics, options?: QualityOptions): QualityReport {
	const settings = checkQualityOptions(options, RULE_IDS);
	const seen = withContext(chart, settings.context);
	const diagnostics: Diagnostic[] = [];
	const suppressed: Suppression[] = [];
	const disabled: string[] = [];
	for (const rule of QUALITY_RULES) {
		const level = settings.levels.get(rule.id);
		if (level === 'off') {
			disabled.push(rule.id);
			continue;
		}
		for (const finding of rule.check(seen)) {
			const diagnostic = level === undefined ? finding : { ...finding, severity: level };
			const why = suppression(rule, diagnostic, settings);
			if (why === undefined) diagnostics.push(diagnostic);
			else suppressed.push(why);
		}
	}
	return { library: chart.library, rulesVersion: RULES_VERSION, diagnostics, suppressed, disabled };
}
