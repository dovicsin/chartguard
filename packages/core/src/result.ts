import type { Coverage, Diagnostic, ValidationResult, ValidationStatus } from './diagnostic.js';
import { documented } from './reference.js';

/** Whether the finding is a confirmed error: severity `error`, whatever its code. */
export function isConfirmedError(diagnostic: Diagnostic): boolean {
	return diagnostic.severity === 'error';
}

/**
 * Producers mark anything they could not decide with `confidence: 'unknown'`, and a likely problem
 * read from a schema fact that is not authoritative with `'inferred'` (CG-02-07). Either keeps a
 * result from `valid`, which needs a complete, authoritative check. Codes carry no meaning here.
 */
function isUndecided(diagnostic: Diagnostic): boolean {
	return diagnostic.confidence !== 'certain';
}

function statusOf(coverage: Coverage, diagnostics: readonly Diagnostic[]): ValidationStatus {
	if (diagnostics.some(isConfirmedError)) return 'invalid';
	if (coverage === 'partial' || diagnostics.some(isUndecided)) return 'partial';
	return 'valid';
}

/**
 * The only place that derives `valid` and `status`; callers never assemble a result by hand. Every
 * finding leaves it with a `documentationUrl`.
 */
export function result(
	library: string,
	schemaVersion: string,
	coverage: Coverage,
	diagnostics: Diagnostic[]
): ValidationResult {
	const status = statusOf(coverage, diagnostics);
	return {
		valid: status !== 'invalid',
		status,
		library,
		schemaVersion,
		coverage,
		diagnostics: diagnostics.map(documented)
	};
}
