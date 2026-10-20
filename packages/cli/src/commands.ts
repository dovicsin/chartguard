import { analyzeCommand } from './analyze-command.js';
import { readJson } from './input.js';
import type { ConfigCommand, ConfigInvocation } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { validationOptions } from './options.js';
import { reportQuality, reportResult } from './report.js';
import { loadConfigValidator } from './schema-source.js';

export type CommandHandler = (invocation: ConfigInvocation, io: Io) => Promise<number>;

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

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
