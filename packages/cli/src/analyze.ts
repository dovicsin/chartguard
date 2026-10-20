import type { ChartUse, SourceObject } from '@chartguard/analysis-typescript';
import type { ConfigValidator, Diagnostic, ValidationOptions, ValidationResult } from '@chartguard/core';

import type { Io } from './io.js';

/** `options` is deliberately absent: it names a sub-tree, and only whole configs are validated today. */
const DEFAULT_CONFIG_NAMES: ReadonlySet<string> = new Set(['config', 'chartConfig']);

export interface AnalyzedEntry {
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

/** A partially extracted object is validated as incomplete input; the engine then treats missing keys as unresolved. */
export function analyzeEntry(
	object: SourceObject,
	validate: ConfigValidator,
	options: ValidationOptions = {}
): AnalyzedEntry {
	const { name, line, complete, binding, diagnostics: notes } = object;
	const result = binding === 'const' ? validate(object.value, { ...options, incomplete: !complete }) : undefined;
	return { name, line, complete, notes, result };
}

/** A config handed to the chart library, validated as incomplete input when it is not fully read. */
export function analyzeUse(use: ChartUse, validate: ConfigValidator, options: ValidationOptions = {}): AnalyzedEntry {
	const { source, pattern, line, complete, diagnostics: notes, value } = use;
	const result = validate(value, { ...options, incomplete: !complete });
	return { name: source ?? 'inline config', pattern, line, complete, notes, result };
}

function describeEntry({ name, pattern, line, complete, result }: AnalyzedEntry): string {
	const status = result === undefined ? 'not validated' : result.status;
	const via = pattern === undefined ? '' : ` (${pattern})`;
	return `${name}${via} @ line ${String(line)}: ${status}${complete ? '' : ' (dynamic / partial)'}`;
}

function describeDiagnostic({ severity, path, message, suggestion }: Diagnostic): string {
	return `  ${severity}: ${[path, message, suggestion].filter((part) => part !== undefined).join(' ')}`;
}

/** What the entries were read and checked with: the tsconfig, and the schema when it is not the shipped one. */
export interface AnalysisNotes {
	readonly schema: string | undefined;
	readonly tsconfig: string | undefined;
}

/** The entries as text, after the notes on how they were read and checked. */
export function printEntries(entries: readonly AnalyzedEntry[], notes: AnalysisNotes, io: Io): void {
	io.out(notes.tsconfig === undefined ? 'Read without a tsconfig.' : `Read with ${notes.tsconfig}.`);
	if (notes.schema !== undefined) io.out(notes.schema.trimStart());
	for (const entry of entries) {
		io.out(describeEntry(entry));
		for (const diagnostic of [...entry.notes, ...(entry.result?.diagnostics ?? [])])
			io.out(describeDiagnostic(diagnostic));
	}
}
