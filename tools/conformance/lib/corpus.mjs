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

/**
 * The explanation prefixes an upstream example's outcome may be listed under. An example that
 * could not be run, or that the runtime rejects for reasons outside the config (no DOM, a map
 * that is downloaded at runtime), is `Environment:`; a runtime complaint the validator cannot see
 * by design (a call inside a callback) is `Out of scope:`. Everything else follows the contract
 * rule of the fixture tables, except where an example still renders and the runtime only
 * complains: a finding of ours may then be the runtime's own complaint (`Agreement:`, reviewed) or
 * a coincidence (`Type contract:`, `Unresolved:`), so it is always listed. Fixture tables pin one
 * cause per case and need no such review.
 */
export function allowedExplanations(outcome) {
	if (outcome.status !== 'ran') return ['Environment:'];
	const required = requiredExplanation(outcome);
	if (required !== undefined) return required === 'False negative (CG-' ? [required, 'Environment:', 'Out of scope:'] : [required];
	if (outcome.runtime !== 'complained') return [];
	if (outcome.findings.some((finding) => finding.startsWith('error '))) return ['Type contract:', 'Agreement:'];
	return outcome.findings.some((finding) => finding.startsWith('warning ')) ? ['Unresolved:', 'Agreement:'] : [];
}
