import type { Coverage, Diagnostic, ValidationResult, ValidationStatus } from './diagnostic.js';

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

/** The only place that derives `valid` and `status`; callers never assemble a result by hand. */
export function result(
	library: string,
	schemaVersion: string,
	coverage: Coverage,
	diagnostics: Diagnostic[]
): ValidationResult {
	const status = statusOf(coverage, diagnostics);
	return { valid: status !== 'invalid', status, library, schemaVersion, coverage, diagnostics };
}
