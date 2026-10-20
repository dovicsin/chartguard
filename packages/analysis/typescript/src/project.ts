import { dirname, resolve } from 'node:path';

import ts from 'typescript';

import { type AnalysisOutput, extract } from './extract.js';
import { READ_ONLY, type ReadOnlyProgram, rootNameOf, sourceFileOf } from './program.js';

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

/** "No inputs were found": expected, since `include` is never expanded (see PARSE_HOST). */
const NO_INPUTS = 18_003;

/**
 * Reads what a tsconfig and its `extends` chain say, never listing a directory: the analysed
 * file is the only root, so `include`/`files` patterns are not expanded.
 */
const PARSE_HOST: ts.ParseConfigHost = {
	useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
	fileExists: (path) => ts.sys.fileExists(path),
	readFile: (path) => ts.sys.readFile(path),
	readDirectory: () => []
};

const messageOf = (diagnostic: ts.Diagnostic): string => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

function compilerOptionsOf(tsconfig: string): ts.CompilerOptions {
	const read = ts.readConfigFile(tsconfig, (path) => ts.sys.readFile(path));
	if (read.error !== undefined) throw new ProjectConfigError(tsconfig, [messageOf(read.error)]);
	const parsed = ts.parseJsonConfigFileContent(read.config, PARSE_HOST, dirname(tsconfig), undefined, tsconfig);
	const problems = parsed.errors.filter(({ code }) => code !== NO_INPUTS).map(messageOf);
	if (problems.length > 0) throw new ProjectConfigError(tsconfig, problems);
	return parsed.options;
}

/** Where the project's options come from: a path, the nearest `tsconfig.json` upward (`true`), or none. */
type TsconfigChoice = string | boolean;

function locateTsconfig(fileName: string, choice: TsconfigChoice): string | undefined {
	if (typeof choice === 'string') return resolve(choice);
	if (!choice) return undefined;
	return ts.findConfigFile(dirname(resolve(fileName)), (path) => ts.sys.fileExists(path));
}

/**
 * The analysed file, with the given text, in a Program built with the project's compiler options:
 * module resolution, lib and types as the project configures them. Other files are read from disk.
 */
function projectProgram(source: string, fileName: string, tsconfig: string | undefined): ReadOnlyProgram {
	const options = { ...(tsconfig === undefined ? {} : compilerOptionsOf(tsconfig)), ...READ_ONLY };
	const rootName = rootNameOf(resolve(fileName));
	const file = sourceFileOf(rootName, source);
	const host = ts.createCompilerHost(options, true);
	const fromDisk = host.getSourceFile.bind(host);
	// TypeScript asks with `/` separators on every platform: compare resolved paths, never strings.
	host.getSourceFile = (name, ...rest) => (resolve(name) === rootName ? file : fromDisk(name, ...rest));
	host.writeFile = () => undefined;
	return { program: ts.createProgram({ rootNames: [rootName], options, host }), file };
}

export interface ProjectOptions {
	/** A tsconfig path, `true` for the nearest `tsconfig.json` upward from the file (default), or `false` for none. */
	readonly tsconfig?: TsconfigChoice;
}

export interface ProjectAnalysis extends AnalysisOutput {
	/** The tsconfig whose compiler options the Program was built with, if any. */
	readonly tsconfig: string | undefined;
}

/**
 * Static extraction of `source`, the text of `fileName`, in a Program built with its project's
 * compiler options (CG-03-02). Throws `ProjectConfigError` for a tsconfig that cannot be used.
 * Nothing is emitted, and no code of the file or the project runs. Node only.
 */
export function analyzeProject(
	source: string,
	fileName: string,
	{ tsconfig = true }: ProjectOptions = {}
): ProjectAnalysis {
	const located = locateTsconfig(fileName, tsconfig);
	return { ...extract(projectProgram(source, fileName, located), fileName), tsconfig: located };
}
