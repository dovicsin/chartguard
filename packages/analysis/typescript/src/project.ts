import { dirname, resolve } from 'node:path';

import type { Diagnostic } from '@chartguard/core';
import ts from 'typescript';

import { type AnalysisOutput, Extraction, type ExtractOptions, refused } from './extract.js';
import { projectHost, type Root } from './host.js';
import { guarded, inputRefusal, refusal, tooDeep } from './limits.js';
import { type Rule, rulesOf } from './patterns.js';
import { READ_ONLY, rootNameOf, sourceFileOf } from './program.js';
import {
	compilerOptionsOf,
	locateTsconfig,
	MAX_PROJECT_FILES,
	ProjectConfigError,
	projectFileNames,
	readProjectFile,
	type TsconfigChoice
} from './tsconfig.js';

export { openSession, ProjectSession } from './session.js';
export { MAX_PROJECT_FILES, ProjectConfigError };

/** A file to analyse and its text (which may differ from the file on disk: an editor's buffer). */
export interface SourceText {
	readonly fileName: string;
	readonly source: string;
}

/** Options of project analysis: extraction options and the tsconfig whose compiler options the Program uses. */
export interface ProjectOptions extends ExtractOptions {
	/** A tsconfig path, `true` for the nearest `tsconfig.json` upward from the (first) file (default), or `false` for none. */
	readonly tsconfig?: TsconfigChoice;
}

/** The analysis of one file of a project, under the name the caller gave it. */
export interface ProjectAnalysis extends AnalysisOutput {
	readonly fileName: string;
	/** The tsconfig whose compiler options the Program was built with, if any. */
	readonly tsconfig: string | undefined;
}

/** The resolved name a given file is a root of the Program under: `a.ts` and `./a.ts` are one root. */
const rootKey = (fileName: string): string => rootNameOf(resolve(fileName));

/** The given texts as the roots of one Program; other files are read from disk (`host.ts`). */
function projectProgram(
	texts: readonly SourceText[],
	tsconfig: string | undefined
): { program: ts.Program; files: Root[] } {
	const options = { ...(tsconfig === undefined ? {} : compilerOptionsOf(tsconfig)), ...READ_ONLY };
	const roots = new Map(
		texts.map(({ fileName, source }) => {
			const root = rootKey(fileName);
			return [root, { file: sourceFileOf(root, source), fileName, root }] as const;
		})
	);
	const host = projectHost(options, roots);
	return { program: ts.createProgram({ rootNames: [...roots.keys()], options, host }), files: [...roots.values()] };
}

/** Why each text is not read at all (CG-03-08), and the texts that are. */
function admitted(texts: readonly SourceText[]): {
	refusals: (Diagnostic | undefined)[];
	readable: SourceText[];
} {
	const refusals = texts.map(({ source, fileName }) => inputRefusal(source, fileName));
	return { refusals, readable: readableOf(texts, refusals) };
}

const readableOf = (texts: readonly SourceText[], refusals: readonly (Diagnostic | undefined)[]): SourceText[] =>
	texts.filter((_, index) => refusals[index] === undefined);

/**
 * The Program of the readable texts and its reading, or `undefined` when building it overflowed the
 * stack: a root nested more deeply than the bracket count sees (E31).
 */
function extractionOf(
	readable: readonly SourceText[],
	tsconfig: string | undefined,
	rules: readonly Rule[]
): { files: Root[]; extraction: Extraction } | undefined {
	return guarded(
		tsconfig ?? '',
		() => {
			const { program, files } = projectProgram(readable, tsconfig);
			return { files, extraction: new Extraction(program, rules) };
		},
		() => undefined
	);
}

/** Every readable text refused: the Program they are read in could not be built. */
const allRefused = (readable: readonly SourceText[]): Map<string, AnalysisOutput> =>
	new Map(readable.map(({ fileName }) => [rootKey(fileName), refused(tooDeep(fileName))] as const));

/** Each text's analysis in the given order: its refusal, or what the Program read for it. */
function ordered(
	texts: readonly SourceText[],
	refusals: readonly (Diagnostic | undefined)[],
	outputs: ReadonlyMap<string, AnalysisOutput>,
	tsconfig: string | undefined
): ProjectAnalysis[] {
	return texts.map(({ fileName }, index) => {
		const why = refusals[index];
		const output = why === undefined ? outputs.get(rootKey(fileName)) : refused(why);
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
	const rules = rulesOf(options.patterns);
	const [first] = texts;
	if (first === undefined) return [];
	const located = locateTsconfig(first.fileName, tsconfig);
	const { refusals, readable } = admitted(texts);
	const built = extractionOf(readable, located, rules);
	const outputs =
		built === undefined
			? allRefused(readable)
			: guarded(
					first.fileName,
					() => new Map(built.files.map((file) => [file.root, built.extraction.read(file)] as const)),
					() => allRefused(readable)
				);
	return ordered(texts, refusals, outputs, located);
}

/** Static extraction of `source`, the text of `fileName`, in a Program built with its project's options (CG-03-02). */
export function analyzeProject(source: string, fileName: string, options: ProjectOptions = {}): ProjectAnalysis {
	const [analysis] = analyzeFiles([{ fileName, source }], options);
	if (analysis === undefined) throw new Error(`No analysis for ${fileName}.`);
	return analysis;
}

/** Options of a project scan (`analyzeProjectFiles`): extraction options, cancellation and a file limit. */
export interface ScanOptions extends ExtractOptions {
	/** Cancels the scan between files: the promise rejects with the signal's reason. */
	readonly signal?: AbortSignal;
	/** Files read at most; defaults to `MAX_PROJECT_FILES`. */
	readonly maxFiles?: number;
}

/**
 * A project scan: the resolved tsconfig path and the analysis of each file read, in the tsconfig's order
 * (a file refused has `readable: false` and why); `truncated` when `maxFiles` left files out.
 */
export interface ProjectScan {
	readonly tsconfig: string;
	readonly files: readonly ProjectAnalysis[];
	/** The project has more files than were read. */
	readonly truncated: boolean;
}

/** A scan option that cannot be used: the caller's input, never ChartGuard's defect (C1). */
export class ScanOptionError extends Error {
	override readonly name = 'ScanOptionError';
}

function checkMaxFiles(maxFiles: unknown): void {
	if (typeof maxFiles !== 'number' || !Number.isSafeInteger(maxFiles) || maxFiles < 0)
		throw new ScanOptionError(`maxFiles must be a non-negative integer; got ${String(maxFiles)}.`);
}

/**
 * The listed files' texts, and why each is not read: outside the project directory, unreadable on
 * disk (CG-03-04-07-08: listed with its reason), too large or too deep (CG-03-08).
 */
function scanned(
	names: readonly string[],
	root: string
): { texts: SourceText[]; refusals: (Diagnostic | undefined)[] } {
	const texts: SourceText[] = [];
	const refusals: (Diagnostic | undefined)[] = [];
	for (const fileName of names) {
		const read = readProjectFile(fileName, root);
		const source = 'source' in read ? read.source : '';
		texts.push({ fileName, source });
		refusals.push('source' in read ? inputRefusal(source, fileName) : refusal(read.code, read.message, fileName));
	}
	return { texts, refusals };
}

const nextTurn = (): Promise<void> =>
	new Promise((done) => {
		setTimeout(done, 0);
	});

/** Each root read in turn, yielding between files so other work runs and `signal` can cancel. */
async function readEach(
	{ files, extraction }: { files: readonly Root[]; extraction: Extraction },
	signal: AbortSignal | undefined
): Promise<Map<string, AnalysisOutput>> {
	const outputs = new Map<string, AnalysisOutput>();
	for (const file of files) {
		await nextTurn();
		signal?.throwIfAborted();
		outputs.set(
			file.root,
			guarded(file.fileName, () => extraction.read(file), refused)
		);
	}
	return outputs;
}

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
	checkMaxFiles(maxFiles);
	const rules = rulesOf(options.patterns);
	const config = resolve(tsconfig);
	const names = projectFileNames(config);
	const { texts, refusals } = scanned(names.slice(0, maxFiles), dirname(config));
	const readable = readableOf(texts, refusals);
	const built = extractionOf(readable, config, rules);
	const outputs = built === undefined ? allRefused(readable) : await readEach(built, signal);
	return { tsconfig: config, files: ordered(texts, refusals, outputs, config), truncated: names.length > texts.length };
}
