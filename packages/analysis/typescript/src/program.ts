import ts from 'typescript';

/** The analysed file inside a Program built only to be read: nothing is emitted or run. */
export interface ReadOnlyProgram {
	readonly program: ts.Program;
	readonly file: ts.SourceFile;
}

const SCRIPT_KINDS: ReadonlyMap<string, ts.ScriptKind> = new Map([
	['.ts', ts.ScriptKind.TS],
	['.mts', ts.ScriptKind.TS],
	['.cts', ts.ScriptKind.TS],
	['.tsx', ts.ScriptKind.TSX],
	['.js', ts.ScriptKind.JS],
	['.mjs', ts.ScriptKind.JS],
	['.cjs', ts.ScriptKind.JS],
	['.jsx', ts.ScriptKind.JSX]
]);

/**
 * A Program accepts only roots with a script extension; any other file (a `.vue` script block saved
 * apart, a `.txt`) is read as TypeScript under a `.ts` root name, and reported under its own name.
 */
export function rootNameOf(fileName: string): string {
	return scriptKindOf(fileName) === undefined ? `${fileName}.ts` : fileName;
}

/** By extension only, as `tsc` decides; no path parsing, so this module runs without Node too. */
function scriptKindOf(fileName: string): ts.ScriptKind | undefined {
	const lower = fileName.toLowerCase();
	return [...SCRIPT_KINDS].find(([extension]) => lower.endsWith(extension))?.[1];
}

export function sourceFileOf(rootName: string, source: string): ts.SourceFile {
	return ts.createSourceFile(
		rootName,
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKindOf(rootName) ?? ts.ScriptKind.TS
	);
}

/** Options no project may change: the Program is only read, and JavaScript files are analysed too. */
export const READ_ONLY: ts.CompilerOptions = { noEmit: true, allowJs: true };

/** One file and nothing else: no lib, no module resolution, no file system. */
export function inMemoryProgram(source: string, fileName: string): ReadOnlyProgram {
	const rootName = rootNameOf(fileName);
	const file = sourceFileOf(rootName, source);
	const host: ts.CompilerHost = {
		getSourceFile: (name) => (name === rootName ? file : undefined),
		getDefaultLibFileName: () => 'lib.d.ts',
		writeFile: () => undefined,
		getCurrentDirectory: () => '',
		getCanonicalFileName: (name) => name,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (name) => name === rootName,
		readFile: (name) => (name === rootName ? source : undefined)
	};
	const options = { ...READ_ONLY, noLib: true, noResolve: true, types: [] };
	return { program: ts.createProgram({ rootNames: [rootName], options, host }), file };
}
