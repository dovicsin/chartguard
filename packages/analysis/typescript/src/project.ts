import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { Diagnostic } from '@chartguard/core';
import ts from 'typescript';

import { type AnalysedFile, type AnalysisOutput, Extraction, type ExtractOptions, refused } from './extract.js';
import { guarded, inputRefusal } from './limits.js';
import { rulesOf } from './patterns.js';
import { READ_ONLY, rootNameOf, sourceFileOf } from './program.js';
import {
	compilerOptionsOf,
	locateTsconfig,
	MAX_PROJECT_FILES,
	ProjectConfigError,
	projectFileNames,
	type TsconfigChoice
} from './tsconfig.js';

export { MAX_PROJECT_FILES, ProjectConfigError };

/** A file to analyse and its text (which may differ from the file on disk: an editor's buffer). */
export interface SourceText {
	readonly fileName: string;
	readonly source: string;
}

export interface ProjectOptions extends ExtractOptions {
	/** A tsconfig path, `true` for the nearest `tsconfig.json` upward from the (first) file (default), or `false` for none. */
	readonly tsconfig?: TsconfigChoice;
}

export interface ProjectAnalysis extends AnalysisOutput {
	readonly fileName: string;
	/** The tsconfig whose compiler options the Program was built with, if any. */
	readonly tsconfig: string | undefined;
}

/**
 * The given files, with their texts, as the roots of one Program built with the project's compiler
 * options: module resolution, lib and types as configured. Other files are read from disk.
 */
function projectProgram(
	texts: readonly SourceText[],
	tsconfig: string | undefined
): { program: ts.Program; files: AnalysedFile[] } {
	const options = { ...(tsconfig === undefined ? {} : compilerOptionsOf(tsconfig)), ...READ_ONLY };
	const roots = new Map(
		texts.map(({ fileName, source }) => {
			const rootName = rootNameOf(resolve(fileName));
			return [rootName, { file: sourceFileOf(rootName, source), fileName }] as const;
		})
	);
	const host = ts.createCompilerHost(options, true);
	const fromDisk = host.getSourceFile.bind(host);
	// TypeScript asks with `/` separators on every platform: compare resolved paths, never strings.
	host.getSourceFile = (name, ...rest) => roots.get(resolve(name))?.file ?? fromDisk(name, ...rest);
	// The given texts exist for module resolution too, whether or not they are on disk yet (an editor's buffers).
	const exists = host.fileExists.bind(host);
	const read = host.readFile.bind(host);
	host.fileExists = (name) => roots.has(resolve(name)) || exists(name);
	const directoryExists = host.directoryExists?.bind(host);
	// By path segment, never by text (E2): `..cache` is inside; another drive is not.
	const holdsRoot = (name: string): boolean =>
		[...roots.keys()].some((root) => {
			const inside = relative(resolve(name), root);
			return inside !== '' && !isAbsolute(inside) && inside.split(sep)[0] !== '..';
		});
	host.directoryExists = (name) => holdsRoot(name) || (directoryExists?.(name) ?? true);
	host.readFile = (name) => roots.get(resolve(name))?.file.text ?? read(name);
	host.writeFile = () => undefined;
	return { program: ts.createProgram({ rootNames: [...roots.keys()], options, host }), files: [...roots.values()] };
}

/** Why each text is not read at all (CG-03-08), and the texts that are. */
function admitted(texts: readonly SourceText[]): {
	refusals: (Diagnostic | undefined)[];
	readable: SourceText[];
} {
	const refusals = texts.map(({ source, fileName }) => inputRefusal(source, fileName));
	return { refusals, readable: texts.filter((_, index) => refusals[index] === undefined) };
}

/** Each text's analysis in the given order: its refusal, or what the Program read for it. */
function ordered(
	texts: readonly SourceText[],
	refusals: readonly (Diagnostic | undefined)[],
	outputs: ReadonlyMap<string, AnalysisOutput>,
	tsconfig: string | undefined
): ProjectAnalysis[] {
	return texts.map(({ fileName }, index) => {
		const refusal = refusals[index];
		const output = refusal === undefined ? outputs.get(fileName) : refused(refusal);
		// Every readable text is a root of the Program, so it has an output.
		if (output === undefined) throw new Error(`No analysis for ${fileName}.`);
		return { ...output, fileName, tsconfig };
	});
}

/**
 * Static extraction of several files of one project, read together in one Program, so each sees the
 * writes and builders of the others (CG-03-07). A file too large or too deep is refused with a note;
 * an unusable tsconfig throws `ProjectConfigError`, malformed patterns `PatternError`. Nothing runs. Node only.
 */
export function analyzeFiles(
	texts: readonly SourceText[],
	{ tsconfig = true, ...options }: ProjectOptions = {}
): ProjectAnalysis[] {
	rulesOf(options.patterns);
	const [first] = texts;
	if (first === undefined) return [];
	const located = locateTsconfig(first.fileName, tsconfig);
	const { refusals, readable } = admitted(texts);
	const outputs = guarded(
		first.fileName,
		() => {
			const { program, files } = projectProgram(readable, located);
			const extraction = new Extraction(program, options);
			return new Map(files.map((file) => [file.fileName, extraction.read(file)] as const));
		},
		(diagnostic) => new Map(readable.map(({ fileName }) => [fileName, refused(diagnostic)] as const))
	);
	return ordered(texts, refusals, outputs, located);
}

/** Static extraction of `source`, the text of `fileName`, in a Program built with its project's options (CG-03-02). */
export function analyzeProject(source: string, fileName: string, options: ProjectOptions = {}): ProjectAnalysis {
	const [analysis] = analyzeFiles([{ fileName, source }], options);
	if (analysis === undefined) throw new Error(`No analysis for ${fileName}.`);
	return analysis;
}

export interface ScanOptions extends ExtractOptions {
	/** Cancels the scan between files: the promise rejects with the signal's reason. */
	readonly signal?: AbortSignal;
	/** Files read at most; defaults to `MAX_PROJECT_FILES`. */
	readonly maxFiles?: number;
}

export interface ProjectScan {
	readonly tsconfig: string;
	readonly files: readonly ProjectAnalysis[];
	/** The project has more files than were read. */
	readonly truncated: boolean;
}

const nextTurn = (): Promise<void> =>
	new Promise((done) => {
		setTimeout(done, 0);
	});

/**
 * Every source file the tsconfig's `include`/`files` name, read in one Program (CG-03-07). Between
 * files the scan yields, so other work runs and `signal` can cancel it; scans may run concurrently,
 * each in its own Program. Bounded by `maxFiles` (CG-03-08).
 */
export async function analyzeProjectFiles(
	tsconfig: string,
	{ signal, maxFiles = MAX_PROJECT_FILES, ...options }: ScanOptions = {}
): Promise<ProjectScan> {
	signal?.throwIfAborted();
	rulesOf(options.patterns);
	const config = resolve(tsconfig);
	const names = projectFileNames(config);
	const texts = names.slice(0, maxFiles).map((fileName) => ({ fileName, source: ts.sys.readFile(fileName) ?? '' }));
	const { refusals, readable } = admitted(texts);
	const { program, files } = projectProgram(readable, config);
	const extraction = new Extraction(program, options);
	const outputs = new Map<string, AnalysisOutput>();
	for (const file of files) {
		await nextTurn();
		signal?.throwIfAborted();
		outputs.set(
			file.fileName,
			guarded(file.fileName, () => extraction.read(file), refused)
		);
	}
	return { tsconfig: config, files: ordered(texts, refusals, outputs, config), truncated: names.length > texts.length };
}
