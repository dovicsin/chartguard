import {
	type ChartUse,
	extractStaticConfigs,
	PatternError,
	rangeAt,
	type SourceRange
} from '@chartguard/analysis-typescript';
import type { Diagnostic, ValidationOptions } from '@chartguard/core';
import type { AST, SourceCode } from 'eslint';

import { renameEdit, type TextEdit, valueEdit } from './edits.js';
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

const describe = ({ code, path, message, suggestion }: Diagnostic): string =>
	`${code} ${path}: ${message}${suggestion === undefined ? '' : ` ${suggestion}`}`;

/**
 * Where a finding stands: the range that wrote its value or the nearest value above it (the config
 * itself at worst), else the use, as a point. One file in memory: every range is in it.
 */
function placeOf(diagnostic: Diagnostic, use: ChartUse): AST.SourceLocation {
	const range = rangeAt(use.paths, diagnostic.path);
	if (range !== undefined) return locationOf(range);
	return locationOf({ line: use.line, column: use.column, endLine: use.line, endColumn: use.column });
}

/** What one file's analysis needs to check its uses and place findings and their edits. */
interface Reading {
	readonly sourceCode: SourceCode;
	readonly fileName: string;
	readonly settings: ChartGuardSettings;
	readonly validators: Validators;
}

/** A finding with its edit: only for a config read completely (an unread part may hold what the edit changes). */
function findingOf(rule: RuleName, diagnostic: Diagnostic, use: ChartUse, { sourceCode }: Reading): Finding {
	const finding = { rule, message: describe(diagnostic), loc: placeOf(diagnostic, use) };
	const { fix } = diagnostic;
	if (fix === undefined || !use.complete) return finding;
	if (fix.kind === 'rename-key') {
		const edit = renameEdit(sourceCode, use, diagnostic.path, fix);
		return edit === undefined ? finding : { ...finding, fix: edit };
	}
	const edit = valueEdit(sourceCode, use, fix);
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
}

/** Per ESLint settings object: as long as ESLint holds it, never longer. */
const prepared = new WeakMap<object, Prepared>();

function prepare(given: Readonly<Record<string, unknown>>): Prepared {
	let known = prepared.get(given);
	if (known === undefined) {
		const settings = readSettings(given);
		known = { settings, validators: new Validators(settings) };
		prepared.set(given, known);
	}
	return known;
}

function analyse(sourceCode: SourceCode, fileName: string, given: Readonly<Record<string, unknown>>): Finding[] {
	const { settings, validators } = prepare(given);
	let output;
	try {
		output = extractStaticConfigs(sourceCode.text, fileName, { patterns: settings.patterns });
	} catch (error) {
		if (error instanceof PatternError) throw new SettingsError([`settings.chartguard.patterns: ${error.message}`]);
		throw error;
	}
	const reading = { sourceCode, fileName, settings, validators };
	// A file TypeScript cannot read (syntax errors, limits) yields no use: nothing read from it is reliable.
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
	fileName: string
): readonly Finding[] {
	const known = analysed.get(sourceCode);
	if (known?.settings === settings) return known.findings;
	const findings = analyse(sourceCode, fileName, settings);
	analysed.set(sourceCode, { settings, findings });
	return findings;
}
