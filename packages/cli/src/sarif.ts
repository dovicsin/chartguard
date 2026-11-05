import { relative, sep } from 'node:path';

import { type Diagnostic, locateJsonPath, parseJsonSource, referenceUrl, type Severity } from '@chartguard/core';

import { cliVersion } from './version.js';

/**
 * Findings as one SARIF 2.1.0 log (CG-06-02 part 1), with the fields code-scanning tools read: a
 * rule per code, a result per finding at its file and region, the JSON path as a logical location.
 * Paths are relative to the working directory, never absolute paths of the machine.
 */
const SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json';
const LEVELS: Readonly<Record<Severity, 'error' | 'warning' | 'note'>> = {
	error: 'error',
	warning: 'warning',
	info: 'note'
};

/** One finding to log: where it is (a file, and a region when known) and, for a quality finding, why it is suppressed. */
export interface SarifFinding {
	readonly diagnostic: Diagnostic;
	readonly file: string;
	readonly region?: SarifRegion;
	/** `false`: the path does not exist in the file; the region is its nearest existing ancestor. */
	readonly exact?: boolean;
	readonly suppressed?: string;
}

export interface SarifRegion {
	readonly startLine: number;
	readonly startColumn: number;
	readonly endLine: number;
	readonly endColumn: number;
}

/** What checked the findings: the library, the command and, for configs, coverage, status and schema. */
export type RunProperties = Readonly<Record<string, string>>;

const uriOf = (file: string): string => relative(process.cwd(), file).split(sep).join('/');

/** Where each path of a JSON file is; undefined when the text is not JSON (its findings get the file only). */
export function jsonLocator(text: string): ((path: string) => Pick<SarifFinding, 'region' | 'exact'>) | undefined {
	const parsed = parseJsonSource(text);
	if (!parsed.ok) return undefined;
	return (path) => {
		const { line, column, endLine, endColumn, exact } = locateJsonPath(parsed.root, path);
		return { region: { startLine: line, startColumn: column, endLine, endColumn }, exact };
	};
}

/** The source region the analysis gave a finding (CG-03-07), when it has one. */
export function sourceRegion({ line, column, endLine, endColumn }: Diagnostic): SarifRegion | undefined {
	if (line === undefined) return undefined;
	const startColumn = column ?? 1;
	return { startLine: line, startColumn, endLine: endLine ?? line, endColumn: endColumn ?? startColumn };
}

/**
 * A rule per code, its help the code's anchor in the reference: what every finding of the code shares.
 * A page about one finding (a deprecation's migration) is that result's, never its rule's.
 */
function rulesOf(findings: readonly SarifFinding[]): object[] {
	const codes = [...new Set(findings.map(({ diagnostic }) => diagnostic.code))];
	return codes.sort((a, b) => (a < b ? -1 : Number(a > b))).map((id) => ({ id, helpUri: referenceUrl(id) }));
}

/** A finding's own page, when it is not its code's (the rule's help). */
function ownPage({ code, documentationUrl }: Diagnostic): object {
	return documentationUrl === undefined || documentationUrl === referenceUrl(code) ? {} : { documentationUrl };
}

function resultOf({ diagnostic, file, region, exact, suppressed }: SarifFinding): object {
	const { code, severity, message, suggestion, path, confidence } = diagnostic;
	return {
		ruleId: code,
		level: LEVELS[severity],
		message: { text: suggestion === undefined ? message : `${message} ${suggestion}` },
		locations: [
			{ physicalLocation: { artifactLocation: { uri: uriOf(file) }, ...(region === undefined ? {} : { region }) } }
		],
		logicalLocations: [{ fullyQualifiedName: path, kind: 'member' }],
		properties: { path, confidence, ...(exact === undefined ? {} : { exact }), ...ownPage(diagnostic) },
		...(suppressed === undefined ? {} : { suppressions: [{ kind: 'external', justification: suppressed }] })
	};
}

export function sarifLog(findings: readonly SarifFinding[], properties: RunProperties): object {
	return {
		$schema: SCHEMA,
		version: '2.1.0',
		runs: [
			{
				tool: {
					driver: {
						name: 'ChartGuard',
						version: cliVersion(),
						informationUri: 'https://github.com/dovicsin/chartguard',
						rules: rulesOf(findings)
					}
				},
				results: findings.map(resultOf),
				properties
			}
		]
	};
}
