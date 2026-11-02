import {
	type ChartUse,
	extractStaticConfigs,
	PatternError,
	rangeAt,
	type SourceRange
} from '@chartguard/analysis-typescript';
import type { ConfigValidator, Diagnostic, ValidationOptions } from '@chartguard/core';
import type { AST, SourceCode } from 'eslint';

import { type ChartGuardSettings, readSettings, SettingsError } from './settings.js';
import { validatorsFor } from './validators.js';

/** One finding as a rule reports it: a claim (error or warning) at an ESLint location (0-based columns). */
export interface Finding {
	readonly severity: 'error' | 'warning';
	readonly message: string;
	readonly loc: AST.SourceLocation;
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

/** The claims about one use: errors and warnings; info findings are no claim. */
function findingsOfUse(use: ChartUse, validate: ConfigValidator, settings: ChartGuardSettings): Finding[] {
	const version = settings.libraryVersion[use.library];
	const options: ValidationOptions = {
		incomplete: !use.complete,
		...(version === undefined ? {} : { libraryVersion: version }),
		...(settings.registries === undefined ? {} : { registries: settings.registries })
	};
	return validate(use.value, options).diagnostics.flatMap((diagnostic) =>
		diagnostic.severity === 'info'
			? []
			: [{ severity: diagnostic.severity, message: describe(diagnostic), loc: placeOf(diagnostic, use) }]
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

function analyse(text: string, fileName: string, given: Readonly<Record<string, unknown>>): Finding[] {
	const settings = readSettings(given);
	const validators = validatorsFor(settings);
	let output;
	try {
		output = extractStaticConfigs(text, fileName, { patterns: settings.patterns });
	} catch (error) {
		if (error instanceof PatternError) throw new SettingsError([`settings.chartguard.patterns: ${error.message}`]);
		throw error;
	}
	// A file TypeScript cannot read (syntax errors, limits) yields no use: nothing read from it is reliable.
	return distinct(output.uses.flatMap((use) => findingsOfUse(use, validators[use.library], settings)));
}

interface Analysed {
	readonly settings: object;
	readonly findings: readonly Finding[];
}

/** Per ESLint `SourceCode` (one file, one name): both rules read one analysis, and none outlives the file ESLint holds. */
const analysed = new WeakMap<SourceCode, Analysed>();

/** The findings of the file `sourceCode` holds, under ESLint's `settings`: analysed once per file and settings. */
export function analysisOf(
	sourceCode: SourceCode,
	settings: Readonly<Record<string, unknown>>,
	fileName: string
): readonly Finding[] {
	const known = analysed.get(sourceCode);
	if (known?.settings === settings) return known.findings;
	const findings = analyse(sourceCode.text, fileName, settings);
	analysed.set(sourceCode, { settings, findings });
	return findings;
}
