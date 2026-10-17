import type { Coverage, Diagnostic, ValidationResult, ValidationStatus } from './diagnostic.js';

const UNRESOLVED_CODES: ReadonlySet<string> = new Set(['CFG_UNKNOWN_KEY', 'CFG_DYNAMIC']);

export function isConfirmedError(diagnostic: Diagnostic): boolean {
	return diagnostic.severity === 'error';
}

function isUnresolved(diagnostic: Diagnostic): boolean {
	return diagnostic.confidence === 'unknown' || UNRESOLVED_CODES.has(diagnostic.code);
}

function statusOf(coverage: Coverage, diagnostics: readonly Diagnostic[]): ValidationStatus {
	if (diagnostics.some(isConfirmedError)) return 'invalid';
	if (coverage === 'partial' || diagnostics.some(isUnresolved)) return 'partial';
	return 'valid';
}

export function result(
	library: string,
	schemaVersion: string,
	coverage: Coverage,
	diagnostics: Diagnostic[]
): ValidationResult {
	const status = statusOf(coverage, diagnostics);
	return { valid: status !== 'invalid', status, library, schemaVersion, coverage, diagnostics };
}
