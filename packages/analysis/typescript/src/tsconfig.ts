import { dirname, resolve, sep } from 'node:path';

import ts from 'typescript';

/** A tsconfig that cannot be used; every problem is listed. The caller's input, never ChartGuard's defect. */
export class ProjectConfigError extends Error {
	override readonly name = 'ProjectConfigError';
	constructor(
		readonly tsconfig: string,
		readonly problems: readonly string[]
	) {
		super(`Cannot use ${tsconfig}:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
	}
}

/** "No inputs were found": expected when `include` is not expanded, or matches nothing. */
const NO_INPUTS = 18_003;

/** Files one project scan reads at most (CG-03-08); the scan says when it stopped there. */
export const MAX_PROJECT_FILES = 2_000;

/**
 * Reads what a tsconfig and its `extends` chain say, never listing a directory: for one file or a
 * given list, those files are the only roots, so `include`/`files` patterns are not expanded.
 */
const OPTIONS_HOST: ts.ParseConfigHost = {
	useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
	fileExists: (path) => ts.sys.fileExists(path),
	readFile: (path) => ts.sys.readFile(path),
	readDirectory: () => []
};

const messageOf = (diagnostic: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

function parsed(tsconfig: string, host: ts.ParseConfigHost): ts.ParsedCommandLine {
	const read = ts.readConfigFile(tsconfig, (path) => ts.sys.readFile(path));
	if (read.error !== undefined) throw new ProjectConfigError(tsconfig, [messageOf(read.error)]);
	const result = ts.parseJsonConfigFileContent(read.config, host, dirname(tsconfig), undefined, tsconfig);
	const problems = result.errors.filter(({ code }) => code !== NO_INPUTS).map(messageOf);
	if (problems.length > 0) throw new ProjectConfigError(tsconfig, problems);
	return result;
}

export function compilerOptionsOf(tsconfig: string): ts.CompilerOptions {
	return parsed(tsconfig, OPTIONS_HOST).options;
}

const SCRIPT = /\.(?:[cm]?[jt]s|[jt]sx)$/i;

/**
 * The project's own source files, as its `include`/`files` name them (a scan asks for this, so
 * directories are listed): no declaration files, nothing under `node_modules`.
 */
export function projectFileNames(tsconfig: string): string[] {
	return parsed(tsconfig, ts.sys)
		.fileNames.map((name) => resolve(name))
		.filter((name) => SCRIPT.test(name) && !/\.d\.[cm]?ts$/i.test(name) && !name.split(sep).includes('node_modules'));
}

/** Where the project's options come from: a path, the nearest `tsconfig.json` upward (`true`), or none. */
export type TsconfigChoice = string | boolean;

export function locateTsconfig(fileName: string, choice: TsconfigChoice): string | undefined {
	if (typeof choice === 'string') return resolve(choice);
	if (!choice) return undefined;
	return ts.findConfigFile(dirname(resolve(fileName)), (path) => ts.sys.fileExists(path));
}
