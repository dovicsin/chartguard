import { type ChartLibrary, type ChartUse, rangeAt, type SourceRange } from '@chartguard/analysis-typescript';
import type { Diagnostic, QualityReport, ValidationOptions, ValidationResult } from '@chartguard/core';
import type ts from 'typescript';

import { type EditSite, offsetOf, renameEdit, type TextEdit, valueEdit } from './edits.js';

/** What a finding is: the validator's error, its warning, or the advisory quality review's warning. */
export type FindingKind = 'valid-config' | 'config-warnings' | 'chart-quality';

/** One finding in the checked text, from `start` to `end` (offsets), with the edit it may offer. */
export interface SourceFinding {
	readonly kind: FindingKind;
	/** The engine's code and path of the finding (`CFG_TYPE`, `$.options.responsive`). */
	readonly code: string;
	readonly path: string;
	readonly message: string;
	readonly start: number;
	readonly end: number;
	/** A behaviour-preserving edit a tool may apply: the runtime's own rename. */
	readonly fix?: TextEdit;
	/** An edit that changes the drawing, offered and never applied without the user. */
	readonly suggestion?: { readonly description: string; readonly edit: TextEdit };
}

/**
 * What checks one use: its library's validator, with the options the caller adds (the version it
 * runs, its registries; `incomplete` is set here), and its quality review with the caller's settings.
 */
export interface Engine {
	validate(library: ChartLibrary, config: unknown, options: ValidationOptions): ValidationResult;
	review(library: ChartLibrary, config: unknown): QualityReport;
}

/** One text being checked, and how the caller tells and names files (a path on disk, or one name in a browser). */
export interface Reading {
	readonly file: ts.SourceFile;
	/** Whether a range the analysis read is in the checked text. */
	readonly inFile: (range: SourceRange) => boolean;
	/** How another file's range is named in a message (project mode only). */
	readonly where: (range: SourceRange) => string;
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
	{ file, inFile, where }: Reading
): Pick<SourceFinding, 'message' | 'start' | 'end'> {
	const message = describe(diagnostic);
	const range = rangeAt(use.paths, diagnostic.path);
	if (range !== undefined && inFile(range))
		return {
			message,
			start: offsetOf(file, range.line, range.column),
			end: offsetOf(file, range.endLine, range.endColumn)
		};
	const at = offsetOf(file, use.line, use.column);
	if (range === undefined) return { message, start: at, end: at };
	return { message: `${message} (written in ${where(range)})`, start: at, end: at };
}

/** A finding with its edit: only for a config read completely (an unread part may hold what the edit changes). */
function findingOf(kind: FindingKind, diagnostic: Diagnostic, use: ChartUse, reading: Reading): SourceFinding {
	const finding = { kind, code: diagnostic.code, path: diagnostic.path, ...placed(diagnostic, use, reading) };
	const { fix } = diagnostic;
	if (fix === undefined || !use.complete) return finding;
	const site: EditSite = { file: reading.file, inFile: reading.inFile, use };
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

/** The validator's claims about one use: errors and warnings; info findings are no claim. */
function validated(use: ChartUse, reading: Reading, engine: Engine): SourceFinding[] {
	const { diagnostics } = engine.validate(use.library, use.value, { incomplete: !use.complete });
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
function reviewed(use: ChartUse, reading: Reading, engine: Engine): SourceFinding[] {
	if (!use.complete) return [];
	return engine
		.review(use.library, use.value)
		.diagnostics.flatMap((diagnostic) =>
			diagnostic.severity === 'warning' ? [findingOf('chart-quality', diagnostic, use, reading)] : []
		);
}

/**
 * The findings about the uses of one readable text (CG-06-04): one source of truth for every tool
 * that reports them (E56). Each is placed as offsets; the caller converts them with its own line rules.
 */
export function findingsOf(uses: readonly ChartUse[], reading: Reading, engine: Engine): SourceFinding[] {
	return distinct(uses.flatMap((use) => [...validated(use, reading, engine), ...reviewed(use, reading, engine)]));
}
