import type { Diagnostic } from '@chartguard/core';

export function confirmed(code: string, path: string, message: string): Diagnostic {
	return { code, severity: 'error', path, message, confidence: 'certain' };
}

export function unresolved(code: string, path: string, message: string): Diagnostic {
	return { code, severity: 'warning', path, message, confidence: 'unknown' };
}
