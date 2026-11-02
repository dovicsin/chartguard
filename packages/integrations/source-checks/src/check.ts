import { relative, resolve } from 'node:path';

import {
	type AnalysisOutput,
	type ChartUse,
	extractStaticConfigs,
	PatternError,
	rangeAt
} from '@chartguard/analysis-typescript';
import type { Diagnostic, ValidationOptions } from '@chartguard/core';
import ts from 'typescript';

import { offsetOf, renameEdit, type TextEdit, valueEdit } from './edits.js';
import { Sessions } from './sessions.js';
import { type ChartGuardSettings, readSettings, SettingsError } from './settings.js';
import { reviewOf, Validators } from './validators.js';

/** What a finding is: the validator's error, its warning, or the advisory quality review's warning. */
export type FindingKind = 'valid-config' | 'config-warnings' | 'chart-quality';

/** One finding in the checked text, from `start` to `end` (offsets), with the edit it may offer. */
export interface SourceFinding {
	readonly kind: FindingKind;
	readonly message: string;
	readonly start: number;
	readonly end: number;
	/** A behaviour-preserving edit a tool may apply: the runtime's own rename. */
	readonly fix?: TextEdit;
	/** An edit that changes the drawing, offered and never applied without the user. */
	readonly suggestion?: { readonly description: string; readonly edit: TextEdit };
}

/** One text being checked. */
interface Reading {
	readonly file: ts.SourceFile;
	readonly fileName: string;
	/** The caller's working directory: other files are named relative to it. */
	readonly cwd: string;
}

const describe = ({ code, path, message, suggestion }: Diagnostic): string =>
	`${code} ${path}: ${message}${suggestion === undefined ? '' : ` ${suggestion}`}`;

/**
 * Where a finding stands and what it says: at the range that wrote its value or the nearest value
 * above it, when that is in the checked file; a value written in another file (project mode) is
 * reported at the use, naming where it was written.
 */
function placed(
	diagnostic: Diagnostic,
	use: ChartUse,
	{ file, fileName, cwd }: Reading
): Pick<SourceFinding, 'message' | 'start' | 'end'> {
	const message = describe(diagnostic);
	const range = rangeAt(use.paths, diagnostic.path);
	if (range !== undefined && resolve(range.file) === resolve(fileName))
		return {
			message,
			start: offsetOf(file, range.line, range.column),
			end: offsetOf(file, range.endLine, range.endColumn)
		};
	const at = offsetOf(file, use.line, use.column);
	if (range === undefined) return { message, start: at, end: at };
	const where = `${relative(cwd, range.file).split('\\').join('/')}:${String(range.line)}:${String(range.column)}`;
	return { message: `${message} (written in ${where})`, start: at, end: at };
}

/** A finding with its edit: only for a config read completely (an unread part may hold what the edit changes). */
function findingOf(kind: FindingKind, diagnostic: Diagnostic, use: ChartUse, reading: Reading): SourceFinding {
	const finding = { kind, ...placed(diagnostic, use, reading) };
	const { fix } = diagnostic;
	if (fix === undefined || !use.complete) return finding;
	const site = { file: reading.file, fileName: reading.fileName, use };
	if (fix.kind === 'rename-key') {
		const edit = renameEdit(site, diagnostic.path, fix);
		return edit === undefined ? finding : { ...finding, fix: edit };
	}
	const edit = valueEdit(site, fix);
	const description = `Set ${fix.path} to ${JSON.stringify(fix.value)}: ${fix.effect}`;
	return edit === undefined ? finding : { ...finding, suggestion: { description, edit } };
}

/** Each finding once: one config handed to two charts is one claim. */
function distinct(findings: readonly SourceFinding[]): SourceFinding[] {
	const seen = new Set<string>();
	return findings.filter((finding) => {
		const key = JSON.stringify(finding);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Checks chart configs in JavaScript and TypeScript source (CG-06-04): the configs a file hands to
 * Chart.js, ECharts or Highcharts, read without running anything, validated and reviewed, each
 * finding at the range that wrote its value, with the edits the engine verified. One checker per
 * settings: its validators, built schemas and project sessions are kept with it.
 */
export class SourceChecker {
	readonly settings: ChartGuardSettings;
	private readonly validators: Validators;
	private readonly sessions: Sessions | undefined;

	/** `given` is checked first: settings that cannot be used throw `SettingsError`, named under `prefix`. */
	constructor(
		given: unknown,
		private readonly prefix: string
	) {
		this.settings = readSettings(given, prefix);
		this.validators = new Validators(this.settings, prefix);
		const { project, patterns } = this.settings;
		this.sessions = project === false ? undefined : new Sessions(project, patterns, prefix);
	}

	/** The findings in `text`, the content of `fileName` (an editor's buffer or the file on disk). */
	check(text: string, fileName: string, cwd: string): SourceFinding[] {
		const output = this.extracted(text, fileName, cwd);
		// A file TypeScript cannot read (syntax errors, limits): nothing read from its tree is reliable, as
		// in the CLI. Its uses are still listed (incomplete), and their values would be checked (A7).
		if (!output.readable) return [];
		const reading = { file: ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true), fileName, cwd };
		return distinct(output.uses.flatMap((use) => [...this.validated(use, reading), ...this.reviewed(use, reading)]));
	}

	/** The file read alone, or in its project's session (project mode). */
	private extracted(text: string, fileName: string, cwd: string): AnalysisOutput {
		try {
			if (this.sessions === undefined)
				return extractStaticConfigs(text, fileName, { patterns: this.settings.patterns });
			return this.sessions.sessionFor(fileName, cwd).analyze(fileName, text);
		} catch (error) {
			if (error instanceof PatternError)
				throw new SettingsError(this.prefix, [`${this.prefix}.patterns: ${error.message}`]);
			throw error;
		}
	}

	/** The validator's claims about one use: errors and warnings; info findings are no claim. */
	private validated(use: ChartUse, reading: Reading): SourceFinding[] {
		const { validators, settings } = this;
		const version = validators.versionFor(use.library, reading.fileName);
		const options: ValidationOptions = {
			incomplete: !use.complete,
			...(version === undefined ? {} : { libraryVersion: version }),
			...(settings.registries === undefined ? {} : { registries: settings.registries })
		};
		const { diagnostics } = validators.validatorFor(use.library, reading.fileName)(use.value, options);
		return diagnostics.flatMap((diagnostic) => {
			if (diagnostic.severity === 'info') return [];
			const kind = diagnostic.severity === 'error' ? 'valid-config' : 'config-warnings';
			return [findingOf(kind, diagnostic, use, reading)];
		});
	}

	/**
	 * The quality review's warnings about a config read completely: of a partial one, an absent option
	 * may be one the analysis could not read, and a review would take it for unset.
	 */
	private reviewed(use: ChartUse, reading: Reading): SourceFinding[] {
		if (!use.complete) return [];
		const report = reviewOf(use.library)(use.value, this.settings.quality);
		return report.diagnostics.flatMap((diagnostic) =>
			diagnostic.severity === 'warning' ? [findingOf('chart-quality', diagnostic, use, reading)] : []
		);
	}
}
