import type { Diagnostic, Fix, QualityReport, ValidationResult } from '@chartguard/core';

import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { Io } from './io.js';
import { schemaNote, type SchemaSource } from './schema-source.js';

const PARTIAL_NOTE = '  NOTE: partial schema coverage; absence of errors is not a compatibility guarantee.';
const ADVISORY_NOTE = '  NOTE: quality findings are advisory and depend on context; they never fail a build.';

/** A fix as a line under its finding: what to set (and what changes), or the key to rename. */
function describeFix(fix: Fix): string {
	if (fix.kind === 'rename-key') return `    FIX rename to ${fix.to} (the runtime reads it so already)`;
	return `    FIX ${fix.path} = ${JSON.stringify(fix.value)}: ${fix.effect}`;
}

function describe(diagnostic: Diagnostic): string {
	const { severity, code, path, message, suggestion, fix } = diagnostic;
	const hint = suggestion === undefined ? '' : ` ${suggestion}`;
	const line = `  ${severity.toUpperCase()} ${code} ${path}: ${message}${hint}`;
	return fix === undefined ? line : `${line}\n${describeFix(fix)}`;
}

/** `4.5.1` or `4.5.1, sha256-1a2b3c4d5e6f` (a short digest identifies the exact generated schema). */
function schemaLabel({ schemaVersion, schemaDigest }: ValidationResult): string {
	return schemaDigest === undefined ? schemaVersion : `${schemaVersion}, ${schemaDigest.slice(0, 19)}`;
}

export function printJson(value: unknown, io: Io): void {
	io.out(JSON.stringify(value, null, 2));
}

export function reportResult(checked: ValidationResult, schema: SchemaSource, json: boolean, io: Io): number {
	if (json) printJson({ mode: 'validate', ...checked, schema }, io);
	else {
		io.out(`${checked.library} ${checked.status} (coverage: ${checked.coverage}; schema ${schemaLabel(checked)})`);
		const note = schemaNote(schema, checked.library);
		if (note !== undefined) io.out(note);
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
		for (const { diagnostic, by, reason } of report.suppressed)
			io.out(`  SUPPRESSED (${by}) ${diagnostic.code} ${diagnostic.path}: ${reason}`);
		if (report.disabled.length > 0) io.out(`  OFF ${report.disabled.join(', ')}`);
		io.out(ADVISORY_NOTE);
	}
	return EXIT_OK;
}
