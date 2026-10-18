import type { Coverage, Diagnostic, ValidationResult, ValidationStatus } from './diagnostic.js';

export function isConfirmedError(diagnostic: Diagnostic): boolean {
	return diagnostic.severity === 'error';
}

/** Producers mark anything they could not decide with `confidence: 'unknown'`; codes carry no meaning here. */
function isUnresolved(diagnostic: Diagnostic): boolean {
	return diagnostic.confidence === 'unknown';
}

function statusOf(coverage: Coverage, diagnostics: readonly Diagnostic[]): ValidationStatus {
	if (diagnostics.some(isConfirmedError)) return 'invalid';
	if (coverage === 'partial' || diagnostics.some(isUnresolved)) return 'partial';
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
