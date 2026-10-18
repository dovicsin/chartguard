import type { Example } from './examples.js';
import type { Verdict } from './runtime.js';

/** What the page showed for one example: every validator finding and the runtime verdict, if rendered. */
export interface Observed {
	readonly findings: readonly string[];
	readonly runtime: Verdict | undefined;
}

export interface SelfTestEntry extends Observed {
	readonly id: string;
	readonly problems: readonly string[];
}

const same = (left: readonly string[], right: readonly string[]): boolean =>
	left.length === right.length && left.every((entry, index) => entry === right[index]);

/**
 * How the browser result differs from what the fixtures pin. A known-valid example must have no
 * warning or error and render silently; a contract example must reproduce its pinned findings and
 * runtime verdict exactly. Without a renderer (Highcharts) only the findings are compared.
 */
export function compare(example: Example, observed: Observed): string[] {
	const problems: string[] = [];
	if (!findingsMatch(example, observed.findings)) {
		const expected = example.expected?.findings ?? 'no warning or error';
		problems.push(`findings ${JSON.stringify(observed.findings)} != ${JSON.stringify(expected)}`);
	}
	const expectedRuntime = example.expected?.runtime ?? 'accepted';
	if (observed.runtime !== undefined && observed.runtime !== expectedRuntime)
		problems.push(`runtime ${observed.runtime} != ${expectedRuntime}`);
	return problems;
}

function findingsMatch(example: Example, findings: readonly string[]): boolean {
	if (example.group === 'valid') return findings.every((finding) => finding.startsWith('info '));
	return same(findings, example.expected?.findings ?? []);
}
