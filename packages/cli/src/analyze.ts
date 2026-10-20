import { type ChartUse, type PathFact, rangeAt, type SourceObject } from '@chartguard/analysis-typescript';
import type { ConfigValidator, Diagnostic, ValidationOptions, ValidationResult } from '@chartguard/core';

import type { Io } from './io.js';

/** `options` is deliberately absent: it names a sub-tree, and only whole configs are validated today. */
const DEFAULT_CONFIG_NAMES: ReadonlySet<string> = new Set(['config', 'chartConfig']);

export interface AnalyzedEntry {
	/** The file the config is in. */
	readonly file: string;
	/** The variable, or the binding passed to a chart use (`config`); an inline config is named by its pattern. */
	readonly name: string;
	/** The chart use this entry was found at (`chartjs.new-chart`), when it was found by its use (CG-03-06). */
	readonly pattern?: string;
	readonly line: number;
	readonly complete: boolean;
	/** Why the object could not be taken at face value; validation ran only when this is empty or dynamic. */
	readonly notes: readonly Diagnostic[];
	/** Absent for a reassignable binding: its initializer may not be the value the chart is built with. */
	readonly result: ValidationResult | undefined;
}

export function selectConfigs(objects: readonly SourceObject[], name: string | undefined): SourceObject[] {
	return objects.filter((object) =>
		name === undefined ? DEFAULT_CONFIG_NAMES.has(object.name) : object.name === name
	);
}

/**
 * Each finding at the source range of the value it is about (CG-03-07): the most specific path
 * fact at or above its path, in whichever file wrote that value.
 */
function located(result: ValidationResult, paths: readonly PathFact[]): ValidationResult {
	return {
		...result,
		diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic, ...rangeAt(paths, diagnostic.path) }))
	};
}

/** A partially extracted object is validated as incomplete input; the engine then treats missing keys as unresolved. */
export function analyzeEntry(
	object: SourceObject,
	file: string,
	validate: ConfigValidator,
	options: ValidationOptions = {}
): AnalyzedEntry {
	const { name, line, complete, binding, diagnostics: notes, paths } = object;
	const result =
		binding === 'const' ? located(validate(object.value, { ...options, incomplete: !complete }), paths) : undefined;
	return { file, name, line, complete, notes, result };
}

/** A config handed to the chart library, validated as incomplete input when it is not fully read. */
export function analyzeUse(
	use: ChartUse,
	file: string,
	validate: ConfigValidator,
	options: ValidationOptions = {}
): AnalyzedEntry {
	const { source, pattern, line, complete, diagnostics: notes, value, paths } = use;
	const result = located(validate(value, { ...options, incomplete: !complete }), paths);
	return { file, name: source ?? 'inline config', pattern, line, complete, notes, result };
}

function describeEntry({ name, pattern, line, complete, result }: AnalyzedEntry): string {
	const status = result === undefined ? 'not validated' : result.status;
	const via = pattern === undefined ? '' : ` (${pattern})`;
	return `${name}${via} @ line ${String(line)}: ${status}${complete ? '' : ' (dynamic / partial)'}`;
}

/** `file:line:column`, where the finding is in source, when it is known. */
function placeOf({ file, line, column }: Diagnostic): string | undefined {
	return file === undefined || line === undefined ? undefined : `${file}:${String(line)}:${String(column ?? 1)}`;
}

function describeDiagnostic(diagnostic: Diagnostic): string {
	const { severity, path, message, suggestion } = diagnostic;
	return `  ${severity}: ${[placeOf(diagnostic), path, message, suggestion].filter((part) => part !== undefined).join(' ')}`;
}

/** What the entries were read and checked with, and what could not be read. */
export interface AnalysisNotes {
	readonly schema: string | undefined;
	readonly tsconfig: string | undefined;
	readonly unreadable: readonly { readonly file: string; readonly diagnostics: readonly Diagnostic[] }[];
	readonly truncated: boolean;
}

function printNotes(notes: AnalysisNotes, io: Io): void {
	io.out(notes.tsconfig === undefined ? 'Read without a tsconfig.' : `Read with ${notes.tsconfig}.`);
	if (notes.truncated) io.out('NOTE: the project has more files than one scan reads; the rest were not read.');
	if (notes.schema !== undefined) io.out(notes.schema.trimStart());
	for (const { file, diagnostics } of notes.unreadable)
		io.out(`${file}: not read (${diagnostics.map(({ message }) => message).join(' ')})`);
}

/** The entries as text, after the notes on how they were read and checked; grouped by file when there are several. */
export function printEntries(entries: readonly AnalyzedEntry[], notes: AnalysisNotes, io: Io): void {
	printNotes(notes, io);
	const several = new Set(entries.map(({ file }) => file)).size > 1;
	let current: string | undefined;
	for (const entry of entries) {
		if (several && entry.file !== current) io.out(`== ${entry.file}`);
		current = entry.file;
		io.out(describeEntry(entry));
		for (const diagnostic of [...entry.notes, ...(entry.result?.diagnostics ?? [])])
			io.out(describeDiagnostic(diagnostic));
	}
}
