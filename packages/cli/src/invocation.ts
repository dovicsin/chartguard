import { join } from 'node:path';
import { parseArgs } from 'node:util';

import type { ConfigValues, ProjectConfig } from './config-file.js';
import { isPattern } from './inputs.js';
import { isLibrary, type Library } from './libraries.js';
import {
	type Command,
	CONFIG_COMMANDS,
	type ConfigCommand,
	FAIL_ON,
	type FailOn,
	type Format,
	FORMATS,
	isFailOn,
	isFormat,
	isOptionName,
	OPTIONS,
	OWNERS
} from './option-table.js';

export type { ConfigCommand, FailOn, Format } from './option-table.js';

/** `validate` or `quality` one input file; `analyze` one or more source files, or a whole project. */
export interface ConfigInvocation {
	readonly command: ConfigCommand;
	readonly library: Library;
	/** The input file, or for `analyze` the first file, or the tsconfig of a project scan: where installed packages are looked up from. */
	readonly file: string;
	/** Every `--file`, a path or a pattern (CG-06-02); empty for a scan of `--project`. */
	readonly files: readonly string[];
	/** `--ignore` patterns: what the files leave out. */
	readonly ignores: readonly string[];
	/** The invocation can name several files (several `--file`, or a pattern): results are listed per file. */
	readonly several: boolean;
	readonly name: string | undefined;
	/** An exact version, `auto` (the installed package), or undefined: no claim about the user's install. */
	readonly libraryVersion: string | undefined;
	/** A JSON file with the registry context: what the user's runtime has registered. */
	readonly registries: string | undefined;
	/** `validate`, `analyze`: every `--plugin-schema`, JSON files of plugin extensions (CG-06-02 part 4c). */
	readonly pluginSchemas: readonly string[];
	/** `analyze`: the tsconfig to build the Program with; undefined discovers the nearest one. */
	readonly project: string | undefined;
	/** `analyze`: a JSON list of the project's own chart wrappers (CG-03-06). */
	readonly patterns: string | undefined;
	/** `quality`: a JSON file with rule settings and the page context (CG-05-05). */
	readonly settings: string | undefined;
	/** `quality`: every `--ruleset`, the rules that run by id or impact (CG-06-02 part 4b); undefined: the settings decide. */
	readonly ruleset: readonly string[] | undefined;
	/** `--cache`: where results are stored and reused (CG-06-02 part 4d); undefined: no cache. */
	readonly cache: string | undefined;
	/** How findings are printed (CG-06-02): `--format`, or `--json` for `json`. */
	readonly format: Format;
	/** `format === 'json'`: also a usage or input error is printed as JSON. */
	readonly json: boolean;
	/** What fails the run (exit 1); undefined: the command's default (`error`; `never` for quality). */
	readonly failOn: FailOn | undefined;
	/** The project config file the options were completed from (CG-06-02 part 3), as named. */
	readonly config: string | undefined;
}

/** `schema build`: generate a library's schema from the install in a project directory. */
export interface SchemaInvocation {
	readonly command: 'schema';
	readonly library: Library;
	readonly directory: string;
	readonly json: boolean;
}

export type Invocation = ConfigInvocation | SchemaInvocation;

type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; tokens: true }>>;
type Values = Parsed['values'];

/** A parsed invocation, or why the arguments are malformed (printed to the user as is). */
export type InvocationResult = { readonly invocation: Invocation } | { readonly reason: string };

const HELP_WORDS: ReadonlySet<string> = new Set(['help', '--help', '-h']);

function isConfigCommand(value: string | undefined): value is ConfigCommand {
	return CONFIG_COMMANDS.some((command) => command === value);
}

export function isHelpRequest(argv: readonly string[]): boolean {
	const [first] = argv;
	return first === undefined || HELP_WORDS.has(first);
}

export function isVersionRequest(argv: readonly string[]): boolean {
	return argv[0] === '--version';
}

/** Whether the user asked for JSON output: `--json` or `--format json` before a `--` terminator. */
export function wantsJson(argv: readonly string[]): boolean {
	const end = argv.indexOf('--');
	const args = end === -1 ? argv : argv.slice(0, end);
	return (
		args.includes('--json') ||
		args.includes('--format=json') ||
		args.some((arg, index) => arg === '--format' && args[index + 1] === 'json')
	);
}

/** The output format: `--format`, or `--json`; both, or an unknown one, is a usage error. */
function formatOf({ json, format }: Values): { readonly format: Format } | { readonly reason: string } {
	if (format === undefined) return { format: json ? 'json' : 'text' };
	if (json) return { reason: '--json and --format are two output formats: give one' };
	return isFormat(format) ? { format } : { reason: `unknown --format '${format}' (${FORMATS.join(', ')})` };
}

/** How the command prints (`--format`, `--json`) and what fails it (`--fail-on`). */
function outputOf(
	values: Values
): { readonly format: Format; readonly failOn: FailOn | undefined } | { readonly reason: string } {
	const format = formatOf(values);
	if ('reason' in format) return format;
	const threshold = failOnOf(values);
	return 'reason' in threshold ? threshold : { ...format, ...threshold };
}

function failOnOf(values: Values): { readonly failOn: FailOn | undefined } | { readonly reason: string } {
	const failOn = values['fail-on'];
	if (failOn === undefined || isFailOn(failOn)) return { failOn };
	return { reason: `unknown --fail-on '${failOn}' (${FAIL_ON.join(', ')})` };
}

/** The options given once per value. */
const MULTIPLE: ReadonlySet<string> = new Set(['file', 'ignore', 'ruleset', 'plugin-schema']);

/** A scalar option given twice would silently take the last value; a repeated file or plugin schema would be read twice. */
function repeated({ tokens, values }: Parsed): string | undefined {
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== 'option' || MULTIPLE.has(token.name)) continue;
		if (seen.has(token.name)) return `--${token.name} is given more than once`;
		seen.add(token.name);
	}
	for (const name of ['file', 'plugin-schema'] as const) {
		const given = values[name] ?? [];
		const twice = given.find((value, index) => given.indexOf(value) !== index);
		if (twice !== undefined) return `--${name} ${twice} is given more than once`;
	}
	return undefined;
}

function misplaced(command: Command, values: Values): string | undefined {
	for (const name of Object.keys(values).filter(isOptionName)) {
		if (values[name] !== undefined && !OWNERS[name].includes(command))
			return `--${name} is not an option of ${command}`;
	}
	return undefined;
}

/** The default cache location, in the working directory's `node_modules/.cache`. */
const CACHE_LOCATION = join('node_modules', '.cache', 'chartguard', 'results');

/** `--cache [--cache-location <dir>]`; a location without `--cache` would silently do nothing. */
function cacheOf(values: Values): { readonly cache: string | undefined } | { readonly reason: string } {
	const location = values['cache-location'];
	if (values.cache !== true)
		return location === undefined ? { cache: undefined } : { reason: '--cache-location needs --cache' };
	return { cache: location ?? CACHE_LOCATION };
}

function libraryOf(values: Values): { readonly library: Library } | { readonly reason: string } {
	const { library } = values;
	if (library === undefined) return { reason: '--library is required' };
	if (!isLibrary(library)) return { reason: `unknown library '${library}' (chartjs, echarts or highcharts)` };
	return { library };
}

/**
 * Every command reads one or more `--file` (paths or patterns); `analyze` may instead read every
 * file of `--project`. The file installed packages are looked up from: the first, or the tsconfig.
 * `--ignore` leaves out some of the files, so it needs them.
 */
function inputOf(command: ConfigCommand, values: Values): { readonly file: string } | { readonly reason: string } {
	const { file: files = [], project, ignore } = values;
	if (ignore !== undefined && files.length === 0) return { reason: '--ignore leaves out files of --file: give --file' };
	const first = files[0] ?? (command === 'analyze' ? project : undefined);
	if (first !== undefined) return { file: first };
	return { reason: command === 'analyze' ? 'analyze needs --file or --project' : `${command} needs --file` };
}

function configInvocation(
	command: ConfigCommand,
	rest: readonly string[],
	values: Values,
	config: string | undefined
): InvocationResult {
	const [extra] = rest;
	if (extra !== undefined) return { reason: `unexpected argument '${extra}'` };
	const chosen = libraryOf(values);
	if ('reason' in chosen) return chosen;
	const input = inputOf(command, values);
	if ('reason' in input) return input;
	const output = outputOf(values);
	if ('reason' in output) return output;
	const cached = cacheOf(values);
	if ('reason' in cached) return cached;
	const { library } = chosen;
	const { format, failOn } = output;
	const invocation = {
		command,
		library,
		...input,
		...givenOf(values),
		...cached,
		format,
		json: format === 'json',
		failOn,
		config
	};
	return { invocation };
}

/** The options a check passes on as given (or as completed from the config file). */
type Given = Omit<ConfigInvocation, 'command' | 'library' | 'file' | 'cache' | 'format' | 'json' | 'failOn' | 'config'>;

function givenOf(values: Values): Given {
	const { file: files = [], ignore: ignores = [], name, registries, project, patterns, settings, ruleset } = values;
	return {
		files,
		ignores,
		several: files.length > 1 || files.some(isPattern),
		name,
		libraryVersion: values['library-version'],
		registries,
		pluginSchemas: values['plugin-schema'] ?? [],
		project,
		patterns,
		settings,
		ruleset
	};
}

/** `schema build --library <library> [--dir <project>] [--json]`, and nothing else. */
function schemaInvocation(rest: readonly string[], values: Values): InvocationResult {
	const [subcommand, extra] = rest;
	if (subcommand !== 'build') return { reason: 'schema has one subcommand: build' };
	if (extra !== undefined) return { reason: `unexpected argument '${extra}'` };
	const chosen = libraryOf(values);
	if ('reason' in chosen) return chosen;
	return {
		invocation: { command: 'schema', library: chosen.library, directory: values.dir ?? '.', json: values.json }
	};
}

/** parseArgs' own refusals (an unknown option, a value for a flag) are the user's; anything else is ours. */
function isParseError(error: unknown): error is Error {
	return error instanceof Error && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS_');
}

function parse(argv: readonly string[]): Parsed | { readonly reason: string } {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, tokens: true });
	} catch (error) {
		if (isParseError(error)) return { reason: error.message };
		throw error;
	}
}

function commandOf(positionals: readonly string[]): { readonly command: Command } | { readonly reason: string } {
	const [command] = positionals;
	if (command === 'schema' || isConfigCommand(command)) return { command };
	if (command === undefined) return { reason: 'no command given' };
	return { reason: `unknown command '${command}'` };
}

/** The invocation, or the first reason it is malformed. */
/**
 * The command line completed from the config file (CG-06-02 part 3): an option the command line
 * leaves out takes the file's value; `--json` or `--format` on the command line replaces its format.
 */
function completed(values: Values, config: ConfigValues): Values {
	const merged: Record<string, unknown> = { ...values };
	for (const [option, value] of Object.entries(config)) {
		const given = option === 'format' ? (values.format ?? (values.json ? 'json' : undefined)) : merged[option];
		if (given === undefined) merged[option] = value;
	}
	return merged as Values;
}

/** A check's invocation, its options completed from the config file. */
function checkInvocation(
	command: ConfigCommand,
	rest: readonly string[],
	given: Values,
	config: ProjectConfig | undefined
): InvocationResult {
	if (given.config !== undefined && given['no-config'] === true)
		return { reason: '--config and --no-config contradict each other: give one' };
	const values = config === undefined ? given : completed(given, config.valuesFor(command));
	return configInvocation(command, rest, values, config?.path);
}

export function parseInvocation(argv: readonly string[], config?: ProjectConfig): InvocationResult {
	if (isVersionRequest(argv)) return { reason: '--version takes no arguments' };
	const parsed = parse(argv);
	if ('reason' in parsed) return parsed;
	const chosen = commandOf(parsed.positionals);
	if ('reason' in chosen) return chosen;
	const { command } = chosen;
	const reason = repeated(parsed) ?? misplaced(command, parsed.values);
	if (reason !== undefined) return { reason };
	const rest = parsed.positionals.slice(1);
	if (command === 'schema') return schemaInvocation(rest, parsed.values);
	return checkInvocation(command, rest, parsed.values, config);
}
