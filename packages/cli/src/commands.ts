import { analyzeCommand } from './analyze-command.js';
import { readJson } from './input.js';
import type { ConfigCommand, ConfigInvocation } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { qualityOptions, validationOptions } from './options.js';
import { reportQuality, reportResult } from './report.js';
import { loadConfigValidator } from './schema-source.js';

export type CommandHandler = (invocation: ConfigInvocation, io: Io) => Promise<number>;

const validateCommand: CommandHandler = async (invocation, io) => {
	const { library, file, json } = invocation;
	const config = await readJson(file);
	const { validate, schema } = await loadConfigValidator(library, file);
	return reportResult(validate(config, await validationOptions(invocation)), schema, json, io);
};

const qualityCommand: CommandHandler = async (invocation, io) => {
	const { library, file, json } = invocation;
	const config = await readJson(file);
	const adapter = await loadQualityAdapter(library);
	const options = await qualityOptions(invocation, adapter);
	return reportQuality(adapter.analyze(config, options), json, io);
};

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
