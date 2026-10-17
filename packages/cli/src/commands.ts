import { readFile } from 'node:fs/promises';

import { analyzeEntry, printEntries, selectConfigs } from './analyze.js';
import { EXIT_INVALID, EXIT_OK } from './exit-codes.js';
import type { Command, Invocation } from './invocation.js';
import type { Io } from './io.js';
import { loadConfigAdapter, loadQualityAdapter } from './libraries.js';
import { printJson, reportResult } from './report.js';

type CommandHandler = (invocation: Invocation, io: Io) => Promise<number>;

async function readJson(file: string): Promise<unknown> {
	return JSON.parse(await readFile(file, 'utf8')) as unknown;
}

const validateCommand: CommandHandler = async ({ library, file, json }, io) => {
	const config = await readJson(file);
	const { validate } = await loadConfigAdapter(library);
	return reportResult(validate(config), json, io);
};

const qualityCommand: CommandHandler = async ({ library, file, json }, io) => {
	const config = await readJson(file);
	const { analyze } = await loadQualityAdapter(library);
	return reportResult({ ...analyze(config), mode: 'quality' }, json, io);
};

const analyzeCommand: CommandHandler = async ({ library, file, name, json }, io) => {
	const text = await readFile(file, 'utf8');
	const { extractStaticConfigs } = await import('@chartguard/analysis-typescript');
	const source = extractStaticConfigs(text, file);
	const configs = selectConfigs(source.objects, name);
	if (configs.length === 0) throw new Error('No suitable static object found. Specify --name <variable>.');
	const { validate } = await loadConfigAdapter(library);
	const entries = configs.map((object) => analyzeEntry(object, validate));
	if (json) printJson({ mode: 'analyze', library, entries, sourceDiagnostics: source.diagnostics }, io);
	else printEntries(entries, source.diagnostics, io);
	return entries.some((entry) => !entry.result.valid) ? EXIT_INVALID : EXIT_OK;
};

export const COMMAND_HANDLERS: Record<Command, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
