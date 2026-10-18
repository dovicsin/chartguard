import { requiredExplanation } from './contract.mjs';

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
 * rule of the fixture tables.
 */
export function allowedExplanations(outcome) {
	if (outcome.status !== 'ran') return ['Environment:'];
	const required = requiredExplanation(outcome);
	if (required === undefined) return [];
	return required === 'False negative (CG-' ? [required, 'Environment:', 'Out of scope:'] : [required];
}
