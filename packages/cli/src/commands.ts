import { readFile } from 'node:fs/promises';

import type { ProjectAnalysis } from '@chartguard/analysis-typescript/project';
import type { Diagnostic, ValidationOptions } from '@chartguard/core';

import { analyzeEntry, printEntries, selectConfigs } from './analyze.js';
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

/** The file read in a Program with its project's options; an unusable tsconfig is the user's input to fix. */
async function analyzeSource(text: string, { file, project }: ConfigInvocation): Promise<ProjectAnalysis> {
	const { analyzeProject, ProjectConfigError } = await import('@chartguard/analysis-typescript/project');
	try {
		return analyzeProject(text, file, { tsconfig: project ?? true });
	} catch (error) {
		if (error instanceof ProjectConfigError) throw new InputError(error.message);
		throw error;
	}
}

const analyzeCommand: CommandHandler = async (invocation, io) => {
	const { library, file, name, json } = invocation;
	const source = await analyzeSource(await readText(file), invocation);
	if (source.diagnostics.length > 0) throw new InputError(describeSyntax(file, source.diagnostics));
	const configs = selectConfigs(source.objects, name);
	if (configs.length === 0) throw new InputError('No suitable static object found. Specify --name <variable>.');
	const { validate, schema } = await loadConfigValidator(library, file);
	const options = await validationOptions(invocation);
	const entries = configs.map((object) => analyzeEntry(object, validate, options));
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
