import type { Diagnostic, QualityReport, Severity, ValidationResult } from '@chartguard/core';

import { type JsonNode, parseJson } from './locate.js';

/** What the playground needs from a library: its published validate and analyze entry points. */
export interface Adapter {
	readonly validate: (config: unknown) => ValidationResult;
	readonly analyze: (config: unknown) => QualityReport;
}

export type Inspection =
	| { readonly kind: 'syntax-error'; readonly message: string; readonly offset: number }
	| {
			readonly kind: 'checked';
			readonly config: unknown;
			readonly tree: JsonNode;
			readonly validation: ValidationResult;
			readonly quality: QualityReport;
	  };

/** Parses the editor text (JSON only: nothing typed is ever executed) and runs both checks. */
export function inspect(text: string, adapter: Adapter): Inspection {
	const parsed = parseJson(text);
	if (!parsed.ok) return { kind: 'syntax-error', message: parsed.message, offset: parsed.offset };
	const config = JSON.parse(text) as unknown;
	return {
		kind: 'checked',
		config,
		tree: parsed.root,
		validation: adapter.validate(config),
		quality: adapter.analyze(config)
	};
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then information; the validator's order within each. */
export function bySeverity(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	const rank = (diagnostic: Diagnostic): number => SEVERITY_ORDER[diagnostic.severity];
	return diagnostics
		.map((diagnostic, index) => ({ diagnostic, index }))
		.sort((left, right) => {
			const bySeverityRank = rank(left.diagnostic) - rank(right.diagnostic);
			return bySeverityRank === 0 ? left.index - right.index : bySeverityRank;
		})
		.map(({ diagnostic }) => diagnostic);
}

export function countBySeverity(diagnostics: readonly Diagnostic[]): Readonly<Record<Severity, number>> {
	const counts = { error: 0, warning: 0, info: 0 };
	for (const { severity } of diagnostics) counts[severity]++;
	return counts;
}

/** `4.5.1 · sha256-23174280b4ee` when the schema is generated, else the version alone. */
export function schemaLabel({ schemaVersion, schemaDigest }: ValidationResult): string {
	return schemaDigest === undefined ? schemaVersion : `${schemaVersion} · ${schemaDigest.slice(0, 19)}`;
}

/** 1-based line and column of a text offset, for syntax errors. */
export function lineAndColumn(text: string, offset: number): { readonly line: number; readonly column: number } {
	const before = text.slice(0, offset).split('\n');
	return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}
