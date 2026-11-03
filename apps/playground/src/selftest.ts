import type { Example } from './examples.js';
/**
 * What the page showed for one example: every validator finding, the runtime verdict, if drawn
 * (`unfinished` when the frame did not answer), and every error nothing caught while it showed the
 * example, in the page or in the frame (a runtime timer that throws after the draw).
 */
export interface Observed {
	readonly findings: readonly string[];
	readonly runtime: string | undefined;
	readonly uncaught: readonly string[];
	/** Drawing frames the page holds besides the one shown (each draw has one, the last only). */
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
 * runtime verdict exactly. Without a runtime (Highcharts) only the findings are compared. An
 * uncaught error, or a frame the page no longer shows, is a problem of every example: the page never
 * leaves an error unhandled nor a drawing behind.
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

/** What the page left behind: errors nothing caught and frames besides the one shown. */
function leftovers({ uncaught, stray = 0 }: Observed): string[] {
	const problems = uncaught.map((error) => `uncaught error: ${error}`);
	if (stray > 0) problems.push(`the page holds ${String(stray)} drawing frame(s) besides the one shown`);
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
