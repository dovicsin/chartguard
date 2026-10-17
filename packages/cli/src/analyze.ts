import type { SourceObject } from '@chartguard/analysis-typescript';
import { type ConfigValidator, type Diagnostic, isConfirmedError, type ValidationResult } from '@chartguard/core';

import type { Io } from './io.js';

const DEFAULT_CONFIG_NAMES: ReadonlySet<string> = new Set(['config', 'options', 'chartConfig']);

export interface AnalyzedEntry {
	readonly name: string;
	readonly line: number;
	readonly complete: boolean;
	readonly result: ValidationResult;
}

export function selectConfigs(objects: readonly SourceObject[], name: string | undefined): SourceObject[] {
	return objects.filter((object) =>
		name === undefined ? DEFAULT_CONFIG_NAMES.has(object.name) : object.name === name
	);
}

/** An unresolved spread or value may supply missing required keys. Do not invent a hard error. */
function softenRequired(diagnostic: Diagnostic): Diagnostic {
	return diagnostic.code === 'CFG_REQUIRED'
		? { ...diagnostic, severity: 'warning', confidence: 'unknown' }
		: diagnostic;
}

export function analyzeEntry(object: SourceObject, validate: ConfigValidator): AnalyzedEntry {
	const base = validate(object.value);
	const diagnostics = object.complete ? base.diagnostics : base.diagnostics.map(softenRequired);
	const valid = !diagnostics.some(isConfirmedError);
	return {
		name: object.name,
		line: object.line,
		complete: object.complete,
		result: { ...base, diagnostics, valid, status: valid ? 'partial' : 'invalid' }
	};
}

export function printEntries(
	entries: readonly AnalyzedEntry[],
	sourceDiagnostics: readonly Diagnostic[],
	io: Io
): void {
	for (const { name, line, complete, result } of entries) {
		io.out(`${name} @ line ${String(line)}: ${result.status}${complete ? '' : ' (dynamic / partial)'}`);
		for (const { severity, path, message, suggestion } of result.diagnostics)
			io.out(`  ${severity}: ${[path, message, suggestion].filter((part) => part !== undefined).join(' ')}`);
	}
	for (const { severity, message } of sourceDiagnostics) io.out(`${severity}: ${message}`);
}
