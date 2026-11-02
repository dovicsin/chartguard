import { analyzeCommand } from './analyze-command.js';
import { readJsonText } from './input.js';
import type { ConfigCommand, ConfigInvocation, FailOn } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { qualityOptions, validationOptions } from './options.js';
import { type Output, reportQuality, reportResult } from './report.js';
import { loadConfigValidator } from './schema-source.js';

export type CommandHandler = (invocation: ConfigInvocation, io: Io) => Promise<number>;

/** How the command prints and fails, with the input's text: `--fail-on` defaults to `error`, for quality to `never`. */
function outputOf({ format, failOn, file }: ConfigInvocation, text: string, fallback: FailOn): Output {
	return { format, failOn: failOn ?? fallback, file, text };
}

const validateCommand: CommandHandler = async (invocation, io) => {
	const { library, file } = invocation;
	const { value: config, text } = await readJsonText(file);
	const { validate, schema } = await loadConfigValidator(library, file);
	const checked = validate(config, await validationOptions(invocation));
	return reportResult(checked, schema, outputOf(invocation, text, 'error'), io);
};

const qualityCommand: CommandHandler = async (invocation, io) => {
	const { library, file } = invocation;
	const { value: config, text } = await readJsonText(file);
	const adapter = await loadQualityAdapter(library);
	const options = await qualityOptions(invocation, adapter);
	return reportQuality(adapter.analyze(config, options), outputOf(invocation, text, 'never'), io);
};

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
