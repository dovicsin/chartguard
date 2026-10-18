import type { Diagnostic, QualityReport, ValidationResult } from '@chartguard/core';

import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { Io } from './io.js';

const PARTIAL_NOTE = '  NOTE: partial schema coverage; absence of errors is not a compatibility guarantee.';
const ADVISORY_NOTE = '  NOTE: quality findings are advisory and depend on context; they never fail a build.';

function describe(diagnostic: Diagnostic): string {
	const { severity, code, path, message, suggestion } = diagnostic;
	const hint = suggestion === undefined ? '' : ` ${suggestion}`;
	return `  ${severity.toUpperCase()} ${code} ${path}: ${message}${hint}`;
}

/** `4.5.1` or `4.5.1, sha256-1a2b3c4d5e6f` (a short digest identifies the exact generated schema). */
function schemaLabel({ schemaVersion, schemaDigest }: ValidationResult): string {
	return schemaDigest === undefined ? schemaVersion : `${schemaVersion}, ${schemaDigest.slice(0, 19)}`;
}

export function printJson(value: unknown, io: Io): void {
	io.out(JSON.stringify(value, null, 2));
}

export function reportResult(checked: ValidationResult, json: boolean, io: Io): number {
	if (json) printJson({ mode: 'validate', ...checked }, io);
	else {
		io.out(`${checked.library} ${checked.status} (coverage: ${checked.coverage}; schema ${schemaLabel(checked)})`);
		for (const diagnostic of checked.diagnostics) io.out(describe(diagnostic));
		if (checked.status === 'partial') io.out(PARTIAL_NOTE);
	}
	return checked.valid ? EXIT_OK : EXIT_INVALID;
}

/** Quality is advisory: the exit status is always success. */
export function reportQuality(report: QualityReport, json: boolean, io: Io): number {
	if (json) printJson({ mode: 'quality', ...report }, io);
	else {
		io.out(`${report.library} quality review (rules ${report.rulesVersion})`);
		for (const diagnostic of report.diagnostics) io.out(describe(diagnostic));
		io.out(ADVISORY_NOTE);
	}
	return EXIT_OK;
}
