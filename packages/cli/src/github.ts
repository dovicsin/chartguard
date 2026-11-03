import { relative, sep } from 'node:path';

import type { Severity } from '@chartguard/core';

import type { SarifFinding, SarifRegion } from './sarif.js';

/**
 * Findings as GitHub workflow commands (CG-06-08): a workflow shows each as an annotation on the line
 * of the value it is about, in the job and on a pull request's diff. Every value is escaped as GitHub
 * reads commands, so text from a config (a key, a file name) never ends the command or starts another.
 */
const LEVELS: Readonly<Record<Severity, 'error' | 'warning' | 'notice'>> = {
	error: 'error',
	warning: 'warning',
	info: 'notice'
};

/** A command's message: `%`, CR and LF escaped (GitHub's `escapeData`). */
export const escapeData = (text: string): string =>
	text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** A command's property value: also `:` and `,`, which end a value (GitHub's `escapeProperty`). */
export const escapeProperty = (text: string): string => escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

/** Where a finding is: GitHub counts the end column inclusively, SARIF exclusively; a column only within one line. */
function position({ startLine, startColumn, endLine, endColumn }: SarifRegion): [string, string][] {
	const end = endLine === startLine ? Math.max(startColumn, endColumn - 1) : endColumn;
	return [
		['line', String(startLine)],
		['col', String(startColumn)],
		['endLine', String(endLine)],
		['endColumn', String(end)]
	];
}

function commandOf({ diagnostic, file, region }: SarifFinding): string {
	const { severity, code, path, message, suggestion } = diagnostic;
	const properties: [string, string][] = [
		['file', relative(process.cwd(), file).split(sep).join('/')],
		...(region === undefined ? [] : position(region)),
		['title', `ChartGuard ${code}`]
	];
	const text = `${path}: ${message}${suggestion === undefined ? '' : ` ${suggestion}`}`;
	const list = properties.map(([name, value]) => `${name}=${escapeProperty(value)}`).join(',');
	return `::${LEVELS[severity]} ${list}::${escapeData(text)}`;
}

/**
 * One command per finding (a suppressed one is none: it was suppressed with a reason), then a summary
 * line of how many of each.
 */
export function githubCommands(findings: readonly SarifFinding[]): string[] {
	const shown = findings.filter(({ suppressed }) => suppressed === undefined);
	const count = (severity: Severity): string =>
		String(shown.filter(({ diagnostic }) => diagnostic.severity === severity).length);
	return [
		...shown.map(commandOf),
		`ChartGuard: ${count('error')} error(s), ${count('warning')} warning(s), ${count('info')} notice(s).`
	];
}
