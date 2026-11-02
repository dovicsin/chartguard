import { relative, resolve } from 'node:path';

import {
	type AnalysisOutput,
	type ChartUse,
	extractStaticConfigs,
	PatternError,
	rangeAt,
	type SourceRange
} from '@chartguard/analysis-typescript';
import type { Diagnostic, ValidationOptions } from '@chartguard/core';
import type { AST, SourceCode } from 'eslint';

import { renameEdit, type TextEdit, valueEdit } from './edits.js';
import { Sessions } from './sessions.js';
import { type ChartGuardSettings, readSettings, SettingsError } from './settings.js';
import { reviewOf, Validators } from './validators.js';

/** The rules: the validator's errors, its warnings, and the advisory quality review. */
export type RuleName = 'valid-config' | 'config-warnings' | 'chart-quality';

/** One finding as its rule reports it, at an ESLint location (0-based columns), with the edit it may offer. */
export interface Finding {
	readonly rule: RuleName;
	readonly message: string;
	readonly loc: AST.SourceLocation;
	/** A behaviour-preserving edit ESLint may apply (`--fix`): the runtime's own rename. */
	readonly fix?: TextEdit;
	/** An edit that changes the drawing, offered and never applied without the user. */
	readonly suggestion?: { readonly description: string; readonly edit: TextEdit };
}

/** The analysis' 1-based, end-exclusive columns as ESLint's 0-based ones; line breaks are counted alike. */
const locationOf = ({ line, column, endLine, endColumn }: Omit<SourceRange, 'file'>): AST.SourceLocation => ({
	start: { line, column: column - 1 },
	end: { line: endLine, column: endColumn - 1 }
});

/** What one file's analysis needs to check its uses and place findings and their edits. */
interface Reading {
	readonly sourceCode: SourceCode;
	readonly fileName: string;
	/** ESLint's working directory: other files are named relative to it. */
	readonly cwd: string;
	readonly settings: ChartGuardSettings;
	readonly validators: Validators;
}

const describe = ({ code, path, message, suggestion }: Diagnostic): string =>
	`${code} ${path}: ${message}${suggestion === undefined ? '' : ` ${suggestion}`}`;

/**
 * Where a finding stands and what it says: at the range that wrote its value or the nearest value
 * above it, when that is in the linted file; a value written in another file (project mode) is
 * reported at the use, naming where it was written.
 */
function placed(diagnostic: Diagnostic, use: ChartUse, { fileName, cwd }: Reading): Pick<Finding, 'message' | 'loc'> {
	const message = describe(diagnostic);
	const range = rangeAt(use.paths, diagnostic.path);
	if (range !== undefined && resolve(range.file) === resolve(fileName)) return { message, loc: locationOf(range) };
	const at = locationOf({ line: use.line, column: use.column, endLine: use.line, endColumn: use.column });
	if (range === undefined) return { message, loc: at };
	const where = `${relative(cwd, range.file).split('\\').join('/')}:${String(range.line)}:${String(range.column)}`;
	return { message: `${message} (written in ${where})`, loc: at };
}

/** A finding with its edit: only for a config read completely (an unread part may hold what the edit changes). */
function findingOf(rule: RuleName, diagnostic: Diagnostic, use: ChartUse, reading: Reading): Finding {
	const { sourceCode, fileName } = reading;
	const finding = { rule, ...placed(diagnostic, use, reading) };
	const { fix } = diagnostic;
	if (fix === undefined || !use.complete) return finding;
	if (fix.kind === 'rename-key') {
		const edit = renameEdit({ sourceCode, fileName, use }, diagnostic.path, fix);
		return edit === undefined ? finding : { ...finding, fix: edit };
	}
	const edit = valueEdit({ sourceCode, fileName, use }, fix);
	const description = `Set ${fix.path} to ${JSON.stringify(fix.value)}: ${fix.effect}`;
	return edit === undefined ? finding : { ...finding, suggestion: { description, edit } };
}

/** The validator's claims about one use: errors and warnings; info findings are no claim. */
function validationFindings(use: ChartUse, reading: Reading): Finding[] {
	const { validators, fileName, settings } = reading;
	const version = validators.versionFor(use.library, fileName);
	const { registries } = settings;
	const options: ValidationOptions = {
		incomplete: !use.complete,
		...(version === undefined ? {} : { libraryVersion: version }),
		...(registries === undefined ? {} : { registries })
	};
	return validators
		.validatorFor(use.library, fileName)(use.value, options)
		.diagnostics.flatMap((diagnostic) => {
			if (diagnostic.severity === 'info') return [];
			const rule = diagnostic.severity === 'error' ? 'valid-config' : 'config-warnings';
			return [findingOf(rule, diagnostic, use, reading)];
		});
}

/**
 * The quality review's warnings about a config read completely: of a partial one, an absent option
 * may be one the analysis could not read, and a review would take it for unset.
 */
function qualityFindings(use: ChartUse, reading: Reading): Finding[] {
	if (!use.complete) return [];
	const report = reviewOf(use.library)(use.value, reading.settings.quality);
	return report.diagnostics.flatMap((diagnostic) =>
		diagnostic.severity === 'warning' ? [findingOf('chart-quality', diagnostic, use, reading)] : []
	);
}

/** Each finding once: one config handed to two charts is one claim. */
function distinct(findings: readonly Finding[]): Finding[] {
	const seen = new Set<string>();
	return findings.filter((finding) => {
		const key = JSON.stringify(finding);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** What one ESLint settings object gives: read and checked once, its validators built once. */
interface Prepared {
	readonly settings: ChartGuardSettings;
	readonly validators: Validators;
	/** Project mode: one analysis session per project. */
	readonly sessions: Sessions | undefined;
}

/** Per ESLint settings object: as long as ESLint holds it, never longer. */
const prepared = new WeakMap<object, Prepared>();

function prepare(given: Readonly<Record<string, unknown>>): Prepared {
	let known = prepared.get(given);
	if (known === undefined) {
		const settings = readSettings(given);
		const { project, patterns } = settings;
		const sessions = project === false ? undefined : new Sessions(project, patterns);
		known = { settings, validators: new Validators(settings), sessions };
		prepared.set(given, known);
	}
	return known;
}

/** The file read alone, or in its project's session (project mode). */
function extracted(text: string, fileName: string, cwd: string, { settings, sessions }: Prepared): AnalysisOutput {
	try {
		if (sessions === undefined) return extractStaticConfigs(text, fileName, { patterns: settings.patterns });
		return sessions.sessionFor(fileName, cwd).analyze(fileName, text);
	} catch (error) {
		if (error instanceof PatternError) throw new SettingsError([`settings.chartguard.patterns: ${error.message}`]);
		throw error;
	}
}

function analyse(
	sourceCode: SourceCode,
	fileName: string,
	cwd: string,
	given: Readonly<Record<string, unknown>>
): Finding[] {
	const known = prepare(given);
	const output = extracted(sourceCode.text, fileName, cwd, known);
	const reading = { sourceCode, fileName, cwd, settings: known.settings, validators: known.validators };
	// A file TypeScript cannot read (syntax errors, limits): nothing read from its tree is reliable, as
	// in the CLI. Its uses are still listed (incomplete), and their values would be checked.
	if (!output.readable) return [];
	return distinct(
		output.uses.flatMap((use) => [...validationFindings(use, reading), ...qualityFindings(use, reading)])
	);
}

interface Analysed {
	readonly settings: object;
	readonly findings: readonly Finding[];
}

/** Per ESLint `SourceCode` (one file, one name): the rules read one analysis, and none outlives the file ESLint holds. */
const analysed = new WeakMap<SourceCode, Analysed>();

/** The findings of the file `sourceCode` holds, under ESLint's `settings`: analysed once per file and settings. */
export function analysisOf(
	sourceCode: SourceCode,
	settings: Readonly<Record<string, unknown>>,
	fileName: string,
	cwd: string
): readonly Finding[] {
	const known = analysed.get(sourceCode);
	if (known?.settings === settings) return known.findings;
	const findings = analyse(sourceCode, fileName, cwd, settings);
	analysed.set(sourceCode, { settings, findings });
	return findings;
}
