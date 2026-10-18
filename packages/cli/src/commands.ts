import { readFile } from 'node:fs/promises';

import type { Diagnostic } from '@chartguard/core';

import { analyzeEntry, printEntries, selectConfigs } from './analyze.js';
import { InputError } from './errors.js';
import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { Command, Invocation } from './invocation.js';
import type { Io } from './io.js';
import { loadConfigAdapter, loadQualityAdapter } from './libraries.js';
import { printJson, reportQuality, reportResult } from './report.js';

type CommandHandler = (invocation: Invocation, io: Io) => Promise<number>;

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

const validateCommand: CommandHandler = async ({ library, file, json }, io) => {
	const config = await readJson(file);
	const { validate } = await loadConfigAdapter(library);
	return reportResult(validate(config), json, io);
};

const qualityCommand: CommandHandler = async ({ library, file, json }, io) => {
	const config = await readJson(file);
	const { analyze } = await loadQualityAdapter(library);
	return reportQuality(analyze(config), json, io);
};

const analyzeCommand: CommandHandler = async ({ library, file, name, json }, io) => {
	const text = await readText(file);
	const { extractStaticConfigs } = await import('@chartguard/analysis-typescript');
	const source = extractStaticConfigs(text, file);
	if (source.diagnostics.length > 0) throw new InputError(describeSyntax(file, source.diagnostics));
	const configs = selectConfigs(source.objects, name);
	if (configs.length === 0) throw new InputError('No suitable static object found. Specify --name <variable>.');
	const { validate } = await loadConfigAdapter(library);
	const entries = configs.map((object) => analyzeEntry(object, validate));
	if (json) printJson({ mode: 'analyze', library, entries }, io);
	else printEntries(entries, io);
	return entries.some((entry) => entry.result?.valid === false) ? EXIT_INVALID : EXIT_OK;
};

export const COMMAND_HANDLERS: Record<Command, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
