import { SourceChecker, type SourceFinding } from '@chartguard/source-checks';
import type { SourceCode } from 'eslint';

/** Where ESLint users write the settings: every setup error names them so. */
const PREFIX = 'settings.chartguard';

/** Per ESLint settings object (one per lint run for every file sharing a config): never longer. */
const checkers = new WeakMap<object, SourceChecker>();

function checkerFor(settings: Readonly<Record<string, unknown>>): SourceChecker {
	let checker = checkers.get(settings);
	if (checker === undefined) {
		checker = new SourceChecker(settings['chartguard'], PREFIX);
		checkers.set(settings, checker);
	}
	return checker;
}

interface Analysed {
	readonly settings: object;
	readonly findings: readonly SourceFinding[];
}

/** Per ESLint `SourceCode` (one file, one name): the rules read one analysis, and none outlives the file ESLint holds. */
const analysed = new WeakMap<SourceCode, Analysed>();

/** The findings of the file `sourceCode` holds, under ESLint's `settings`: analysed once per file and settings. */
export function analysisOf(
	sourceCode: SourceCode,
	settings: Readonly<Record<string, unknown>>,
	fileName: string,
	cwd: string
): readonly SourceFinding[] {
	const known = analysed.get(sourceCode);
	if (known?.settings === settings) return known.findings;
	const findings = checkerFor(settings).check(sourceCode.text, fileName, cwd);
	analysed.set(sourceCode, { settings, findings });
	return findings;
}
