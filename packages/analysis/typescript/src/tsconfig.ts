import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

import { MAX_SOURCE_LENGTH } from './limits.js';

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

/** A project file's text, or why the scan does not read it (`code`, `message`). */
export type ProjectFileRead =
	| { readonly source: string }
	| { readonly code: 'CFG_OUTSIDE_PROJECT' | 'CFG_UNREADABLE' | 'CFG_TOO_LARGE'; readonly message: string };

/** Bytes a file of `MAX_SOURCE_LENGTH` characters takes at most in UTF-8: a larger file is not even loaded. */
const MAX_SOURCE_BYTES = MAX_SOURCE_LENGTH * 3;

/** Whether `path` is `directory` or below it, by path segment (E2). */
function isInside(path: string, directory: string): boolean {
	const inside = relative(directory, path);
	return inside === '' || (!isAbsolute(inside) && inside.split(sep)[0] !== '..');
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A file a scan lists, read only when it really lies in the project directory (`root`, the
 * tsconfig's directory, both after following symbolic links): a link out of it, or an `include` or
 * `files` entry outside it, is not read without the user's choice. A file that cannot be read says why.
 */
export function readProjectFile(fileName: string, root: string): ProjectFileRead {
	try {
		const real = realpathSync(fileName);
		if (!isInside(real, realpathSync(root)))
			return {
				code: 'CFG_OUTSIDE_PROJECT',
				message: `The file is outside the project directory ${root} (it is ${real}); it is not read.`
			};
		const { size } = statSync(real);
		if (size > MAX_SOURCE_BYTES)
			return { code: 'CFG_TOO_LARGE', message: `The file has ${String(size)} bytes; it is not read.` };
		return { source: readFileSync(real, 'utf8') };
	} catch (error) {
		return { code: 'CFG_UNREADABLE', message: `The file cannot be read: ${reasonOf(error)}` };
	}
}
