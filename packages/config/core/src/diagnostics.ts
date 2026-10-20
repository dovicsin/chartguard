import type { Diagnostic } from '@chartguard/core';

export function confirmed(code: string, path: string, message: string): Diagnostic {
	return { code, severity: 'error', path, message, confidence: 'certain' };
}

export function unresolved(code: string, path: string, message: string): Diagnostic {
	return { code, severity: 'warning', path, message, confidence: 'unknown' };
}

export function inconclusive(code: string, path: string, message: string): Diagnostic {
	return { code, severity: 'info', path, message, confidence: 'unknown' };
}

/**
 * A finding read from a schema fact that is not authoritative (CG-02-07): an error becomes a
 * warning and a certain finding an inferred one; an undecided finding stays undecided.
 */
export function asInferred(diagnostic: Diagnostic): Diagnostic {
	if (diagnostic.confidence !== 'certain') return diagnostic;
	return {
		...diagnostic,
		severity: diagnostic.severity === 'error' ? 'warning' : diagnostic.severity,
		confidence: 'inferred'
	};
}
