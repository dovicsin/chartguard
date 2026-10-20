import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { ChartPattern } from '@chartguard/analysis-typescript';
import type { ProjectAnalysis } from '@chartguard/analysis-typescript/project';
import { type ConfigValidator, type Diagnostic, isRecord, type ValidationOptions } from '@chartguard/core';

import { type AnalyzedEntry, analyzeEntry, analyzeUse, printEntries, selectConfigs } from './analyze.js';
import { InputError } from './errors.js';
import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import { installedVersion } from './installed.js';
import type { ConfigCommand, ConfigInvocation } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { printJson, reportQuality, reportResult } from './report.js';
import { loadConfigValidator, schemaNote } from './schema-source.js';

type CommandHandler = (invocation: ConfigInvocation, io: Io) => Promise<number>;

const BOM = '﻿';

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function readText(file: string): Promise<string> {
	try {
		const text = await readFile(file, 'utf8');
		return text.startsWith(BOM) ? text.slice(BOM.length) : text;
	} catch (error) {
		throw new InputError(`Cannot read ${file}: ${describeError(error)}`);
	}
}

async function readJson(file: string): Promise<unknown> {
	const text = await readText(file);
	try {
		return JSON.parse(text) as unknown;
	} catch (error) {
		throw new InputError(`${file} is not valid JSON: ${describeError(error)}`);
	}
}

function describeSyntax(file: string, diagnostics: readonly Diagnostic[]): string {
	const lines = diagnostics.map(({ line, column, message }) => `\n  ${String(line)}:${String(column)} ${message}`);
	return `${file} has syntax errors; nothing read from it is reliable.${lines.join('')}`;
}

/** `--library-version auto` reads the installed package; an explicit version is passed as given. */
async function versionOptions({ library, file, libraryVersion }: ConfigInvocation): Promise<ValidationOptions> {
	if (libraryVersion === undefined) return {};
	return { libraryVersion: libraryVersion === 'auto' ? await installedVersion(library, file) : libraryVersion };
}

/**
 * The validation context the invocation gives. The registry file must be readable JSON (input
 * error otherwise); its shape is the validator's to judge, so a malformed context is a finding.
 */
async function validationOptions(invocation: ConfigInvocation): Promise<ValidationOptions> {
	const version = await versionOptions(invocation);
	if (invocation.registries === undefined) return version;
	// Untrusted JSON: the validator reads it structurally and reports a malformed context.
	const registries = (await readJson(invocation.registries)) as NonNullable<ValidationOptions['registries']>;
	return { ...version, registries };
}

const validateCommand: CommandHandler = async (invocation, io) => {
	const { library, file, json } = invocation;
	const config = await readJson(file);
	const { validate, schema } = await loadConfigValidator(library, file);
	return reportResult(validate(config, await validationOptions(invocation)), schema, json, io);
};

const qualityCommand: CommandHandler = async ({ library, file, json }, io) => {
	const config = await readJson(file);
	const { analyze } = await loadQualityAdapter(library);
	return reportQuality(analyze(config), json, io);
};

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

/** The file read in a Program with its project's options; an unusable tsconfig or pattern is the user's input to fix. */
async function analyzeSource(text: string, { file, project, patterns }: ConfigInvocation): Promise<ProjectAnalysis> {
	const { analyzeProject, ProjectConfigError } = await import('@chartguard/analysis-typescript/project');
	const { PatternError } = await import('@chartguard/analysis-typescript');
	const extraPatterns = await readPatterns(patterns);
	try {
		return analyzeProject(text, file, { tsconfig: project ?? true, patterns: extraPatterns });
	} catch (error) {
		if (error instanceof ProjectConfigError || error instanceof PatternError) throw new InputError(error.message);
		throw error;
	}
}

/**
 * The configs to validate: where the file hands them to the library (CG-03-06), or, with `--name`
 * or without any use of this library, the variables chosen by name.
 */
function entriesOf(
	source: ProjectAnalysis,
	invocation: ConfigInvocation,
	check: ValidatorWithOptions
): AnalyzedEntry[] {
	const uses = source.uses.filter((use) => use.library === invocation.library);
	if (invocation.name === undefined && uses.length > 0)
		return uses.map((use) => analyzeUse(use, check.validate, check.options));
	const configs = selectConfigs(source.objects, invocation.name);
	if (configs.length === 0)
		throw new InputError(
			`No ${invocation.library} chart use and no suitable static object found. Specify --name <variable>.`
		);
	return configs.map((object) => analyzeEntry(object, check.validate, check.options));
}

interface ValidatorWithOptions {
	readonly validate: ConfigValidator;
	readonly options: ValidationOptions;
}

const analyzeCommand: CommandHandler = async (invocation, io) => {
	const { library, file, json } = invocation;
	const source = await analyzeSource(await readText(file), invocation);
	if (source.diagnostics.length > 0) throw new InputError(describeSyntax(file, source.diagnostics));
	const { validate, schema } = await loadConfigValidator(library, file);
	const entries = entriesOf(source, invocation, { validate, options: await validationOptions(invocation) });
	const project = { tsconfig: source.tsconfig ?? null };
	if (json) printJson({ mode: 'analyze', library, schema, project, entries }, io);
	else printEntries(entries, { schema: schemaNote(schema, library), tsconfig: source.tsconfig }, io);
	return entries.some((entry) => entry.result?.valid === false) ? EXIT_INVALID : EXIT_OK;
};

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
