import { analyzeCommand } from './analyze-command.js';
import { isQualityReport, isValidationResult, openCache, type ResultCache } from './cache.js';
import { InputError, RunInputError } from './errors.js';
import { readJsonText } from './input.js';
import { expandInputs } from './inputs.js';
import type { ConfigCommand, ConfigInvocation, FailOn } from './invocation.js';
import type { Io } from './io.js';
import { loadQualityAdapter } from './libraries.js';
import { qualityOptions, validationOptions } from './options.js';
import { readPluginSchemas } from './plugins.js';
import { type CheckedFile, checkedQuality, checkedResult, type Output, type UnusableFile } from './report.js';
import { schemaFinder } from './schema-source.js';
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
			if (!(error instanceof InputError) || error instanceof RunInputError || !invocation.several) throw error;
			results.push({ file, error: error.message });
		}
	return results;
}

/** The run's result cache, when `--cache` asks for one (CG-06-02 part 4d). */
async function cacheOf({ cache }: ConfigInvocation, io: Io): Promise<ResultCache | undefined> {
	return cache === undefined ? undefined : openCache(cache, io);
}

/** `compute()`, or its result stored under `parts` in the cache. */
function through<T>(
	cache: ResultCache | undefined,
	parts: unknown,
	is: (value: unknown) => value is T,
	compute: () => Promise<T>
): Promise<T> {
	return cache === undefined ? compute() : cache.through(parts, is, compute);
}

const validateCommand: CommandHandler = async (invocation, io) => {
	const { library } = invocation;
	const plugins = await readPluginSchemas(invocation.pluginSchemas);
	const schemas = schemaFinder(library, plugins);
	const cache = await cacheOf(invocation, io);
	const results = await checkFiles(invocation, async (file) => {
		const { value: config, text } = await readJsonText(file);
		const found = await schemas(file);
		const { options, version } = await validationOptions({ ...invocation, file });
		// Everything the result depends on; the code is part of every key.
		const parts = { command: 'validate', library, text, options, schema: found.identity, plugins: plugins.extensions };
		const checked = await through(cache, parts, isValidationResult, async () =>
			(await found.validator())(config, options)
		);
		return checkedResult(checked, found.schema, outputOf(invocation, file, text, 'error'), version);
	});
	return printFiles('validate', results, invocation, io);
};

const qualityCommand: CommandHandler = async (invocation, io) => {
	const { library } = invocation;
	const adapter = await loadQualityAdapter(library);
	const options = await qualityOptions(invocation, adapter);
	const cache = await cacheOf(invocation, io);
	const results = await checkFiles(invocation, async (file) => {
		const { value: config, text } = await readJsonText(file);
		const parts = { command: 'quality', library, text, options: options ?? null };
		const report = await through(cache, parts, isQualityReport, () =>
			Promise.resolve(adapter.analyze(config, options))
		);
		return checkedQuality(report, outputOf(invocation, file, text, 'never'));
	});
	return printFiles('quality', results, invocation, io);
};

export const COMMAND_HANDLERS: Record<ConfigCommand, CommandHandler> = {
	validate: validateCommand,
	quality: qualityCommand,
	analyze: analyzeCommand
};
