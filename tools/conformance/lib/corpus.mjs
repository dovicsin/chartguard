import { fileURLToPath } from 'node:url';

import { SOURCES } from '../corpus/sources.mjs';
import { requiredExplanation } from './contract.mjs';

/**
 * Where a corpus lives: committed next to its sources, or, when its license does not clear
 * redistribution, in the local cache every checkout imports into (never tracked, never packed).
 */
export function corpusFile(library) {
	const local = SOURCES[library]?.redistributable === false;
	const where = local ? `../../../node_modules/.cache/chartguard/corpus/${library}.json` : `../corpus/${library}.json`;
	return fileURLToPath(new URL(where, import.meta.url));
}

/** Rendered silently, and the validator reported neither a warning nor an error. */
export function isClean(outcome) {
	return (
		outcome.status === 'ran' &&
		outcome.runtime === 'accepted' &&
		!outcome.findings.some((finding) => finding.startsWith('error ') || finding.startsWith('warning '))
	);
}

/** Certain advisories: the upstream deprecates the option, or the runtime ignores it. Not noise. */
const ADVISORY_CODES = new Set(['CFG_DEPRECATED', 'CFG_INEFFECTIVE']);

/**
 * Rendered silently, and the validator reported no error and no warning other than a certain
 * advisory. What the minimum per corpus guards: noise (uncertain warnings, false errors) is never
 * quiet, while a correct, explained deprecation does not count against an example.
 */
export function isQuiet(outcome) {
	if (outcome.status !== 'ran' || outcome.runtime !== 'accepted') return false;
	return outcome.findings.every((finding) => {
		const [severity, code] = finding.split(' ');
		return severity === 'info' || (severity === 'warning' && ADVISORY_CODES.has(code));
	});
}

/**
 * The explanation prefixes an upstream example's outcome may be listed under. An example that
 * could not be run, or that the runtime rejects for reasons outside the config (no DOM, a map
 * that is downloaded at runtime), is `Environment:`; a runtime complaint the validator cannot see
 * by design (a call inside a callback) is `Out of scope:`. Everything else follows the contract
 * rule of the fixture tables, except where an example still renders and the runtime only
 * complains: a finding of ours may then be the runtime's own complaint (`Agreement:`, reviewed),
 * explained on its own (`Type contract:`, `Unresolved:`, `Deprecated:`, `No effect:`), or the
 * complaint may come from the page (`Environment:`), so it is always listed. Fixture tables pin one
 * cause per case and need no such review.
 */
export function allowedExplanations(outcome) {
	if (outcome.status !== 'ran') return ['Environment:'];
	const required = requiredExplanation(outcome);
	if (required !== undefined)
		return required === 'False negative (CG-' ? [required, 'Environment:', 'Out of scope:'] : [required];
	if (outcome.runtime !== 'complained') return [];
	// What our findings would need on an example the runtime accepts, then: the runtime's complaint
	// is ours (`Agreement:`), or comes from the page, not the options (`Environment:`).
	const own = requiredExplanation({ findings: outcome.findings, runtime: 'accepted' });
	return own === undefined ? [] : [own, 'Agreement:', 'Environment:'];
}
