import type { Example } from './examples.js';
import type { Verdict } from './runtime.js';

/**
 * What the page showed for one example: every validator finding, the runtime verdict, if rendered,
 * and every error the page did not catch while it showed the example (a runtime callback that throws
 * after the draw the verdict was taken from).
 */
export interface Observed {
	readonly findings: readonly string[];
	readonly runtime: Verdict | undefined;
	readonly uncaught: readonly string[];
	/** Charts the runtime still holds besides the one shown, if rendered. */
	readonly stray: number | undefined;
}

export interface SelfTestEntry extends Observed {
	readonly id: string;
	readonly problems: readonly string[];
}

const same = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * How the browser result differs from what the fixtures pin (`claimsOnly`: the page lists only
 * errors and warnings, source mode). A known-valid example must have no
 * warning or error and render silently; a contract example must reproduce its pinned findings and
 * runtime verdict exactly. Without a renderer (Highcharts) only the findings are compared. An
 * uncaught error, or a chart the runtime holds that the page no longer shows, is a problem of every
 * example: the page never leaves an error unhandled nor a chart behind.
 */
export function compare(example: Example, observed: Observed, { claimsOnly = false } = {}): string[] {
	const problems: string[] = [];
	if (!findingsMatch(example, observed.findings, claimsOnly)) {
		const expected = pinned(example, claimsOnly) ?? 'no warning or error';
		problems.push(`findings ${JSON.stringify(observed.findings)} != ${JSON.stringify(expected)}`);
	}
	const expectedRuntime = example.expected?.runtime ?? 'accepted';
	if (observed.runtime !== undefined && observed.runtime !== expectedRuntime)
		problems.push(`runtime ${observed.runtime} != ${expectedRuntime}`);
	return [...problems, ...leftovers(observed)];
}

/** What the page left behind: errors it did not catch and charts the runtime holds but the page no longer shows. */
function leftovers({ uncaught, stray = 0 }: Observed): string[] {
	const problems = uncaught.map((error) => `uncaught error: ${error}`);
	if (stray > 0) problems.push(`the runtime still holds ${String(stray)} chart(s) the page does not show`);
	return problems;
}

/** The findings a contract pins; with `claimsOnly`, its errors and warnings (as the editors list them). */
function pinned(example: Example, claimsOnly: boolean): readonly string[] | undefined {
	const findings = example.expected?.findings;
	return claimsOnly ? findings?.filter((finding) => !finding.startsWith('info ')) : findings;
}

function findingsMatch(example: Example, findings: readonly string[], claimsOnly: boolean): boolean {
	if (example.group === 'valid') return findings.every((finding) => finding.startsWith('info '));
	return same(findings, pinned(example, claimsOnly) ?? []);
}
