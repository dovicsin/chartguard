import { dirname, resolve } from 'node:path';

import type { ChartPattern } from '@chartguard/analysis-typescript';
import type { ProjectAnalysis } from '@chartguard/analysis-typescript/project';
import { type ConfigValidator, isRecord, type ValidationOptions } from '@chartguard/core';

import { type AnalyzedEntry, analyzeEntry, analyzeUse, printEntries, selectConfigs } from './analyze.js';
import { InputError } from './errors.js';
import { exitStatus } from './exit.js';
import { describeUnreadable, readJson, readText } from './input.js';
import { expandInputs } from './inputs.js';
import type { ConfigInvocation } from './invocation.js';
import type { Io } from './io.js';
import { validationOptions } from './options.js';
import { readPluginSchemas } from './plugins.js';
import { extensionProperty, printJson } from './report.js';
import { type RunProperties, type SarifFinding, sarifLog, sourceRegion } from './sarif.js';
import { loadConfigValidator, pluginNote, schemaNote, type SchemaSource } from './schema-source.js';
import { settingsNote } from './several.js';

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

/** Each file once, by its resolved path (`a.ts` and `./a.ts` are one file), in the order first given. */
function distinctFiles(files: readonly string[]): string[] {
	return files.filter((file, index) => files.findIndex((other) => resolve(other) === resolve(file)) === index);
}

/** The files `--file` names, through patterns and ignores (CG-06-02 part 2); none for a scan of `--project`. */
async function sourceFiles({ files: inputs, ignores }: ConfigInvocation): Promise<string[]> {
	if (inputs.length === 0) return [];
	const files = await expandInputs(inputs, ignores);
	if (files.length === 0) throw new InputError('every --file is left out by --ignore.');
	return files;
}

/** The files read in one Program with their project's options; an unusable tsconfig or pattern is the user's input. */
async function readSources(invocation: ConfigInvocation): Promise<Read> {
	const { project, patterns } = invocation;
	const files = await sourceFiles(invocation);
	const { analyzeFiles, analyzeProjectFiles, ProjectConfigError, ScanOptionError } =
		await import('@chartguard/analysis-typescript/project');
	const { PatternError } = await import('@chartguard/analysis-typescript');
	const extraPatterns = await readPatterns(patterns);
	const texts = await Promise.all(
		distinctFiles(files).map(async (fileName) => ({ fileName, source: await readText(fileName) }))
	);
	try {
		if (texts.length === 0 && project !== undefined) {
			const scan = await analyzeProjectFiles(project, { patterns: extraPatterns });
			return { analyses: scan.files, tsconfig: scan.tsconfig, truncated: scan.truncated };
		}
		const analyses = analyzeFiles(texts, { tsconfig: project ?? true, patterns: extraPatterns });
		return { analyses, tsconfig: analyses[0]?.tsconfig, truncated: false };
	} catch (error) {
		if (error instanceof ProjectConfigError || error instanceof ScanOptionError || error instanceof PatternError)
			throw new InputError(error.message);
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

/** The entries of the files that could be read, checked with the library's schema; none found is the user's input. */
async function checkedEntries(
	invocation: ConfigInvocation,
	read: Read
): Promise<{ entries: AnalyzedEntry[]; schema: SchemaSource }> {
	const { library, file, name } = invocation;
	const plugins = await readPluginSchemas(invocation.pluginSchemas);
	const { validate, schema } = await loadConfigValidator(library, file, plugins);
	const { options } = await validationOptions(invocation);
	const check = { validate, options, library, name };
	const entries = read.analyses
		.filter((analysis) => analysis.readable)
		.flatMap((analysis) => entriesOf(analysis, check));
	if (entries.length === 0)
		throw new InputError(`No ${library} chart use and no suitable static object found. Specify --name <variable>.`);
	return { entries, schema };
}

/** The entries in the invocation's format, with how they were read and checked. */
function printAnalysis(
	invocation: ConfigInvocation,
	{
		entries,
		schema,
		read,
		findings
	}: { entries: AnalyzedEntry[]; schema: SchemaSource; read: Read; findings: SarifFinding[] },
	io: Io
): void {
	const { library, config } = invocation;
	const unreadable = read.analyses
		.filter((analysis) => !analysis.readable)
		.map(({ fileName, diagnostics }) => ({ file: fileName, diagnostics }));
	const project = { tsconfig: read.tsconfig ?? null, ...(read.truncated ? { truncated: true } : {}) };
	if (invocation.format === 'sarif') {
		const properties = { ...analysisProperties(library, entries), ...(config === undefined ? {} : { config }) };
		printJson(sarifLog(findings, properties), io);
		return;
	}
	if (invocation.json) {
		const skipped = unreadable.length > 0 ? { unreadable } : {};
		printJson({ mode: 'analyze', library, schema, project, entries, ...skipped }, io);
		return;
	}
	if (config !== undefined) io.out(settingsNote(config));
	const plugins = pluginNote(entries.find(({ result }) => result !== undefined)?.result?.extensions);
	const notes = {
		schema: schemaNote(schema, library),
		plugins,
		tsconfig: read.tsconfig,
		unreadable,
		truncated: read.truncated
	};
	printEntries(entries, notes, io);
}

export async function analyzeCommand(invocation: ConfigInvocation, io: Io): Promise<number> {
	const read = await readSources(invocation);
	const unreadable = read.analyses.filter((analysis) => !analysis.readable);
	// Nothing could be read: each file and why, never "no chart use found".
	if (unreadable.length > 0 && unreadable.length === read.analyses.length)
		throw new InputError(
			unreadable.map(({ fileName, diagnostics }) => describeUnreadable(fileName, diagnostics)).join('\n')
		);
	const { entries, schema } = await checkedEntries(invocation, read);
	const findings = entries.flatMap(findingsOf);
	printAnalysis(invocation, { entries, schema, read, findings }, io);
	return exitStatus(invocation.failOn ?? 'error', {
		invalid: entries.some((entry) => entry.result?.valid === false),
		diagnostics: findings.map(({ diagnostic }) => diagnostic)
	});
}

/** Each finding of an entry (its extraction notes and its validation) at the source range the analysis gives it, else at the entry. */
function findingsOf(entry: AnalyzedEntry): SarifFinding[] {
	const at = { startLine: entry.line, startColumn: 1, endLine: entry.line, endColumn: 1 };
	return [...entry.notes, ...(entry.result?.diagnostics ?? [])].map((diagnostic) => ({
		diagnostic,
		file: diagnostic.file ?? entry.file,
		region: sourceRegion(diagnostic) ?? at
	}));
}

/** What checked the entries: partial as soon as one is (or one was not validated), and the schema of the first. */
function analysisProperties(library: string, entries: readonly AnalyzedEntry[]): RunProperties {
	const results = entries.flatMap(({ result }) => (result === undefined ? [] : [result]));
	const partial = results.length < entries.length || results.some(({ coverage }) => coverage === 'partial');
	const [first] = results;
	return {
		mode: 'analyze',
		library,
		coverage: partial ? 'partial' : 'full',
		...(first === undefined ? {} : { schemaVersion: first.schemaVersion }),
		...(first?.schemaDigest === undefined ? {} : { schemaDigest: first.schemaDigest }),
		...extensionProperty(first?.extensions)
	};
}
