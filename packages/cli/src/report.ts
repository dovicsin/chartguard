import type { Diagnostic, ValidationResult } from '@chartguard/core';

import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { Io } from './io.js';

const PARTIAL_NOTE = '  NOTE: partial schema coverage; absence of errors is not a compatibility guarantee.';

function describe(diagnostic: Diagnostic): string {
	const { severity, code, path, message, suggestion } = diagnostic;
	const hint = suggestion === undefined ? '' : ` ${suggestion}`;
	return `  ${severity.toUpperCase()} ${code} ${path}: ${message}${hint}`;
}

export function printJson(value: unknown, io: Io): void {
	io.out(JSON.stringify(value, null, 2));
}

export type ReportedResult = ValidationResult & { readonly mode?: string };

export function reportResult(checked: ReportedResult, json: boolean, io: Io): number {
	if (json) printJson(checked, io);
	else {
		io.out(`${checked.library} ${checked.status} (coverage: ${checked.coverage}; schema ${checked.schemaVersion})`);
		for (const diagnostic of checked.diagnostics) io.out(describe(diagnostic));
		if (checked.status === 'partial') io.out(PARTIAL_NOTE);
	}
	return checked.valid ? EXIT_OK : EXIT_INVALID;
}
