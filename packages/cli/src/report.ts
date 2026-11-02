import type { Diagnostic, Fix, QualityReport, ValidationResult } from '@chartguard/core';

import { exitStatus } from './exit.js';
import type { ResolvedVersion } from './installed.js';
import type { FailOn, Format } from './invocation.js';
import type { Io } from './io.js';
import { jsonLocator, type RunProperties, type SarifFinding } from './sarif.js';
import { schemaNote, type SchemaSource } from './schema-source.js';

const PARTIAL_NOTE = '  NOTE: partial schema coverage; absence of errors is not a compatibility guarantee.';
const ADVISORY_NOTE =
	'  NOTE: quality findings are advisory and depend on context; they fail a build only with --fail-on warning.';
const FAILING_NOTE =
	'  NOTE: quality findings are advisory and depend on context; --fail-on warning makes them fail this run.';

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

/** The fields the CLI adds to a result in `validate --json`: the command, the schema, and with several files the file. */
interface CliFields {
	readonly mode: 'validate';
	readonly schema: SchemaSource;
	readonly file: string;
}

/**
 * `never` (a compile error below) as soon as ValidationResult gains a field the CLI writes too: the
 * spread would silently lose one of them. The result itself is copied whole, `valid` and `status`
 * as core derived them (B1).
 */
type ValidateJson =
	Extract<keyof ValidationResult, keyof CliFields> extends never ? ValidationResult & Partial<CliFields> : never;

function validateJson(checked: ValidationResult, schema: SchemaSource): ValidateJson {
	return { ...checked, schema };
}

/**
 * One input file, checked (CG-06-02): how each format shows it and the exit status its findings
 * give under `--fail-on`. One file and several files are printed by the same parts.
 */
export interface CheckedFile {
	readonly file: string;
	/** Its JSON report, without the command's `mode`. */
	readonly json: object;
	readonly text: (io: Io) => void;
	readonly findings: readonly SarifFinding[];
	readonly properties: RunProperties;
	/** The exit status its findings give under `--fail-on`. */
	readonly exitCode: number;
}

/** A file among several that could not be used: its reason. */
export interface UnusableFile {
	readonly file: string;
	readonly error: string;
}

/** How a command prints and fails: its `--format`, its `--fail-on`, and the input file's text (for SARIF positions). */
export interface Output {
	readonly format: Format;
	readonly failOn: FailOn;
	readonly file: string;
	readonly text: string;
}

/** Each finding of a JSON input at the region of its path in the file. */
function jsonFindings(diagnostics: readonly Diagnostic[], { file, text }: Output): SarifFinding[] {
	const locate = jsonLocator(text);
	return diagnostics.map((diagnostic) => ({ diagnostic, file, ...locate?.(diagnostic.path) }));
}

/** Where `--library-version auto` found the version it validated against. */
const versionNote = ({ version, source }: ResolvedVersion): string => `  version ${version} from ${source}`;

/** What checked a config: library, command, coverage, status and the schema's version and digest. */
function runProperties(mode: string, checked: ValidationResult): RunProperties {
	return {
		mode,
		library: checked.library,
		coverage: checked.coverage,
		resultStatus: checked.status,
		schemaVersion: checked.schemaVersion,
		...(checked.schemaDigest === undefined ? {} : { schemaDigest: checked.schemaDigest })
	};
}

export function checkedResult(
	checked: ValidationResult,
	schema: SchemaSource,
	output: Output,
	version?: ResolvedVersion
): CheckedFile {
	const resolved =
		version === undefined ? {} : { libraryVersion: version.version, libraryVersionSource: version.source };
	return {
		file: output.file,
		json: validateJson(checked, schema),
		text: (io) => {
			io.out(`${checked.library} ${checked.status} (coverage: ${checked.coverage}; schema ${schemaLabel(checked)})`);
			const note = schemaNote(schema, checked.library);
			if (note !== undefined) io.out(note);
			if (version !== undefined) io.out(versionNote(version));
			for (const diagnostic of checked.diagnostics) io.out(describe(diagnostic));
			if (checked.status === 'partial') io.out(PARTIAL_NOTE);
		},
		findings: jsonFindings(checked.diagnostics, output),
		properties: { ...runProperties('validate', checked), ...resolved },
		exitCode: exitStatus(output.failOn, { invalid: !checked.valid, diagnostics: checked.diagnostics })
	};
}

/** Quality is advisory: it fails only under an explicit `--fail-on warning` (its findings are never errors). */
export function checkedQuality(report: QualityReport, output: Output): CheckedFile {
	const suppressed = report.suppressed.map(({ diagnostic, reason }) => ({
		...jsonFindings([diagnostic], output)[0],
		diagnostic,
		file: output.file,
		suppressed: reason
	}));
	return {
		file: output.file,
		json: report,
		text: (io) => {
			io.out(`${report.library} quality review (rules ${report.rulesVersion})`);
			for (const diagnostic of report.diagnostics) io.out(describe(diagnostic));
			for (const { diagnostic, by, reason } of report.suppressed)
				io.out(`  SUPPRESSED (${by}) ${diagnostic.code} ${diagnostic.path}: ${reason}`);
			if (report.disabled.length > 0) io.out(`  OFF ${report.disabled.join(', ')}`);
			io.out(output.failOn === 'never' ? ADVISORY_NOTE : FAILING_NOTE);
		},
		findings: [...jsonFindings(report.diagnostics, output), ...suppressed],
		properties: { mode: 'quality', library: report.library, rulesVersion: report.rulesVersion },
		exitCode: exitStatus(output.failOn, { invalid: false, diagnostics: report.diagnostics })
	};
}
