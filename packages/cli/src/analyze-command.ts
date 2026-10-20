import { dirname, resolve } from 'node:path';

import type { ChartPattern } from '@chartguard/analysis-typescript';
import type { ProjectAnalysis } from '@chartguard/analysis-typescript/project';
import { type ConfigValidator, isRecord, type ValidationOptions } from '@chartguard/core';

import { type AnalyzedEntry, analyzeEntry, analyzeUse, printEntries, selectConfigs } from './analyze.js';
import { InputError } from './errors.js';
import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import { describeUnreadable, readJson, readText } from './input.js';
import type { ConfigInvocation } from './invocation.js';
import type { Io } from './io.js';
import { validationOptions } from './options.js';
import { printJson } from './report.js';
import { loadConfigValidator, schemaNote } from './schema-source.js';

/**
 * The patterns file: a JSON list; a `file` in a pattern is relative to the patterns file. Its
 * shape is checked by the analysis (`PatternError`): either way the user's input to fix.
 */
async function readPatterns(path: string | undefined): Promise<readonly ChartPattern[]> {
	if (path === undefined) return [];
	const patterns = await readJson(path);
	if (!Array.isArray(patterns)) throw new InputError(`${path} must hold a JSON list of patterns.`);
	return patterns.map((pattern: unknown) =>
		isRecord(pattern) && typeof pattern['file'] === 'string'
			? { ...pattern, file: resolve(dirname(path), pattern['file']) }
			: pattern
	) as ChartPattern[];
}

/** What the invocation reads: its files together in one Program, or every file of `--project` (CG-03-07). */
interface Read {
	readonly analyses: readonly ProjectAnalysis[];
	readonly tsconfig: string | undefined;
	/** A project scan stopped at its file limit. */
	readonly truncated: boolean;
}

/** The files read in one Program with their project's options; an unusable tsconfig or pattern is the user's input. */
async function readSources({ files, project, patterns }: ConfigInvocation): Promise<Read> {
	const { analyzeFiles, analyzeProjectFiles, ProjectConfigError } =
		await import('@chartguard/analysis-typescript/project');
	const { PatternError } = await import('@chartguard/analysis-typescript');
	const extraPatterns = await readPatterns(patterns);
	const texts = await Promise.all(files.map(async (fileName) => ({ fileName, source: await readText(fileName) })));
	try {
		if (texts.length === 0 && project !== undefined) {
			const scan = await analyzeProjectFiles(project, { patterns: extraPatterns });
			return { analyses: scan.files, tsconfig: scan.tsconfig, truncated: scan.truncated };
		}
		const analyses = analyzeFiles(texts, { tsconfig: project ?? true, patterns: extraPatterns });
		return { analyses, tsconfig: analyses[0]?.tsconfig, truncated: false };
	} catch (error) {
		if (error instanceof ProjectConfigError || error instanceof PatternError) throw new InputError(error.message);
		throw error;
	}
}

interface Check {
	readonly validate: ConfigValidator;
	readonly options: ValidationOptions;
	readonly library: string;
	readonly name: string | undefined;
}

/**
 * The configs of one file to validate: where it hands them to the library (CG-03-06), or, with
 * `--name` or without any use of this library, the variables chosen by name.
 */
function entriesOf(analysis: ProjectAnalysis, check: Check): AnalyzedEntry[] {
	const { fileName } = analysis;
	const uses = analysis.uses.filter((use) => use.library === check.library);
	if (check.name === undefined && uses.length > 0)
		return uses.map((use) => analyzeUse(use, fileName, check.validate, check.options));
	return selectConfigs(analysis.objects, check.name).map((object) =>
		analyzeEntry(object, fileName, check.validate, check.options)
	);
}

export async function analyzeCommand(invocation: ConfigInvocation, io: Io): Promise<number> {
	const { library, file, json, name } = invocation;
	const read = await readSources(invocation);
	const unreadable = read.analyses.filter((analysis) => !analysis.readable);
	const [only] = unreadable;
	if (only !== undefined && read.analyses.length === 1)
		throw new InputError(describeUnreadable(only.fileName, only.diagnostics));
	const { validate, schema } = await loadConfigValidator(library, file);
	const check = { validate, options: await validationOptions(invocation), library, name };
	const entries = read.analyses
		.filter((analysis) => analysis.readable)
		.flatMap((analysis) => entriesOf(analysis, check));
	if (entries.length === 0)
		throw new InputError(`No ${library} chart use and no suitable static object found. Specify --name <variable>.`);
	const skipped = unreadable.map(({ fileName, diagnostics }) => ({ file: fileName, diagnostics }));
	const project = { tsconfig: read.tsconfig ?? null, ...(read.truncated ? { truncated: true } : {}) };
	if (json)
		printJson(
			{ mode: 'analyze', library, schema, project, entries, ...(skipped.length > 0 ? { unreadable: skipped } : {}) },
			io
		);
	else
		printEntries(
			entries,
			{ schema: schemaNote(schema, library), tsconfig: read.tsconfig, unreadable: skipped, truncated: read.truncated },
			io
		);
	return entries.some((entry) => entry.result?.valid === false) ? EXIT_INVALID : EXIT_OK;
}
