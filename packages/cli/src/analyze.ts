import type { SourceObject } from '@chartguard/analysis-typescript';
import type { ConfigValidator, Diagnostic, ValidationOptions, ValidationResult } from '@chartguard/core';

import type { Io } from './io.js';

/** `options` is deliberately absent: it names a sub-tree, and only whole configs are validated today. */
const DEFAULT_CONFIG_NAMES: ReadonlySet<string> = new Set(['config', 'chartConfig']);

export interface AnalyzedEntry {
	readonly name: string;
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

function describeEntry({ name, line, complete, result }: AnalyzedEntry): string {
	const status = result === undefined ? 'not validated' : result.status;
	return `${name} @ line ${String(line)}: ${status}${complete ? '' : ' (dynamic / partial)'}`;
}

function describeDiagnostic({ severity, path, message, suggestion }: Diagnostic): string {
	return `  ${severity}: ${[path, message, suggestion].filter((part) => part !== undefined).join(' ')}`;
}

export function printEntries(entries: readonly AnalyzedEntry[], io: Io): void {
	for (const entry of entries) {
		io.out(describeEntry(entry));
		for (const diagnostic of [...entry.notes, ...(entry.result?.diagnostics ?? [])])
			io.out(describeDiagnostic(diagnostic));
	}
}
