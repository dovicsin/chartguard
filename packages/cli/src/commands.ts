import { analyzeCommand } from './analyze-command.js';
import { InputError } from './errors.js';
import { readJsonText } from './input.js';
import { expandInputs } from './inputs.js';
import type { ConfigCommand, ConfigInvocation, FailOn } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { qualityOptions, validationOptions } from './options.js';
import { type CheckedFile, checkedQuality, checkedResult, type Output, type UnusableFile } from './report.js';
import { loadConfigValidator } from './schema-source.js';
import { printFiles } from './several.js';

export type CommandHandler = (invocation: ConfigInvocation, io: Io) => Promise<number>;

/** How the command prints and fails, with the input's text: `--fail-on` defaults to `error`, for quality to `never`. */
function outputOf({ format, failOn }: ConfigInvocation, file: string, text: string, fallback: FailOn): Output {
	return { format, failOn: failOn ?? fallback, file, text };
}

/**
 * Each file the invocation names, checked by `check` (CG-06-02 part 2). With one file a file that
 * cannot be used ends the run as before; among several it is listed and the others still checked.
 */
async function checkFiles(
	invocation: ConfigInvocation,
	check: (file: string) => Promise<CheckedFile>
): Promise<(CheckedFile | UnusableFile)[]> {
	const files = await expandInputs(invocation.files, invocation.ignores);
	if (files.length === 0) throw new InputError('every --file is left out by --ignore.');
	const results: (CheckedFile | UnusableFile)[] = [];
	for (const file of files)
		try {
			results.push(await check(file));
		} catch (error) {
			if (!(error instanceof InputError) || !invocation.several) throw error;
			results.push({ file, error: error.message });
		}
	return results;
}

const validateCommand: CommandHandler = async (invocation, io) => {
	const { library } = invocation;
	const results = await checkFiles(invocation, async (file) => {
		const { value: config, text } = await readJsonText(file);
		const { validate, schema } = await loadConfigValidator(library, file);
		const checked = validate(config, await validationOptions({ ...invocation, file }));
		return checkedResult(checked, schema, outputOf(invocation, file, text, 'error'));
	});
	return printFiles('validate', results, invocation, io);
};

const qualityCommand: CommandHandler = async (invocation, io) => {
	const adapter = await loadQualityAdapter(invocation.library);
	const options = await qualityOptions(invocation, adapter);
	const results = await checkFiles(invocation, async (file) => {
		const { value: config, text } = await readJsonText(file);
		return checkedQuality(adapter.analyze(config, options), outputOf(invocation, file, text, 'never'));
	});
	return printFiles('quality', results, invocation, io);
};

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
