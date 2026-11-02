import { parseArgs } from 'node:util';

import { isLibrary, type Library } from './libraries.js';

const CONFIG_COMMANDS = ['validate', 'quality', 'analyze'] as const;
export type ConfigCommand = (typeof CONFIG_COMMANDS)[number];

/** `validate` or `quality` one input file; `analyze` one or more source files, or a whole project. */
export interface ConfigInvocation {
	readonly command: ConfigCommand;
	readonly library: Library;
	/** The input file, or for `analyze` the first file, or the tsconfig of a project scan: where installed packages are looked up from. */
	readonly file: string;
	/** `analyze`: every `--file`; empty for a scan of `--project`. */
	readonly files: readonly string[];
	readonly name: string | undefined;
	/** An exact version, `auto` (the installed package), or undefined: no claim about the user's install. */
	readonly libraryVersion: string | undefined;
	/** A JSON file with the registry context: what the user's runtime has registered. */
	readonly registries: string | undefined;
	/** `analyze`: the tsconfig to build the Program with; undefined discovers the nearest one. */
	readonly project: string | undefined;
	/** `analyze`: a JSON list of the project's own chart wrappers (CG-03-06). */
	readonly patterns: string | undefined;
	/** `quality`: a JSON file with rule settings and the page context (CG-05-05). */
	readonly settings: string | undefined;
	readonly json: boolean;
}

/** `schema build`: generate a library's schema from the install in a project directory. */
export interface SchemaInvocation {
	readonly command: 'schema';
	readonly library: Library;
	readonly directory: string;
	readonly json: boolean;
}

export type Invocation = ConfigInvocation | SchemaInvocation;

const OPTIONS = {
	library: { type: 'string' },
	file: { type: 'string', multiple: true },
	name: { type: 'string' },
	'library-version': { type: 'string' },
	registries: { type: 'string' },
	project: { type: 'string' },
	patterns: { type: 'string' },
	settings: { type: 'string' },
	dir: { type: 'string' },
	json: { type: 'boolean', default: false }
} as const;

type OptionName = keyof typeof OPTIONS;
type Command = ConfigCommand | 'schema';
type Parsed = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; tokens: true }>>;
type Values = Parsed['values'];

/** A parsed invocation, or why the arguments are malformed (printed to the user as is). */
export type InvocationResult = { readonly invocation: Invocation } | { readonly reason: string };

const ALL_COMMANDS: readonly Command[] = [...CONFIG_COMMANDS, 'schema'];

/**
 * Which commands take each option (C4): `--name`, `--project` and `--patterns` belong to `analyze`;
 * `--library-version` and `--registries` to the config checks, not to `quality`; `--settings` to
 * `quality` only; `--dir` to `schema build`.
 */
const OWNERS: Readonly<Record<OptionName, readonly Command[]>> = {
	library: ALL_COMMANDS,
	json: ALL_COMMANDS,
	file: CONFIG_COMMANDS,
	name: ['analyze'],
	project: ['analyze'],
	patterns: ['analyze'],
	'library-version': ['validate', 'analyze'],
	registries: ['validate', 'analyze'],
	settings: ['quality'],
	dir: ['schema']
};

const HELP_WORDS: ReadonlySet<string> = new Set(['help', '--help', '-h']);

function isConfigCommand(value: string | undefined): value is ConfigCommand {
	return CONFIG_COMMANDS.some((command) => command === value);
}

function isOptionName(name: string): name is OptionName {
	return Object.hasOwn(OPTIONS, name);
}

export function isHelpRequest(argv: readonly string[]): boolean {
	const [first] = argv;
	return first === undefined || HELP_WORDS.has(first);
}

export function isVersionRequest(argv: readonly string[]): boolean {
	return argv[0] === '--version';
}

/** Whether the user asked for JSON output: `--json` before a `--` terminator. */
export function wantsJson(argv: readonly string[]): boolean {
	const end = argv.indexOf('--');
	return (end === -1 ? argv : argv.slice(0, end)).includes('--json');
}

/** A scalar option given twice would silently take the last value; a repeated file would be read twice. */
function repeated({ tokens, values }: Parsed): string | undefined {
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== 'option' || token.name === 'file') continue;
		if (seen.has(token.name)) return `--${token.name} is given more than once`;
		seen.add(token.name);
	}
	const files = values.file ?? [];
	const twice = files.find((file, index) => files.indexOf(file) !== index);
	return twice === undefined ? undefined : `--file ${twice} is given more than once`;
}

function misplaced(command: Command, values: Values): string | undefined {
	for (const name of Object.keys(values).filter(isOptionName)) {
		if (values[name] !== undefined && !OWNERS[name].includes(command))
			return `--${name} is not an option of ${command}`;
	}
	return undefined;
}

function libraryOf(values: Values): { readonly library: Library } | { readonly reason: string } {
	const { library } = values;
	if (library === undefined) return { reason: '--library is required' };
	if (!isLibrary(library)) return { reason: `unknown library '${library}' (chartjs, echarts or highcharts)` };
	return { library };
}

/**
 * `validate` and `quality` read exactly one file; `analyze` one or more, or with none, every file
 * of `--project`. The file installed packages are looked up from: the first, or the tsconfig.
 */
function inputOf(command: ConfigCommand, values: Values): { readonly file: string } | { readonly reason: string } {
	const { file: files = [], project } = values;
	if (command === 'analyze') {
		const first = files[0] ?? project;
		return first === undefined ? { reason: 'analyze needs --file or --project' } : { file: first };
	}
	const [file] = files;
	return files.length === 1 && file !== undefined ? { file } : { reason: `${command} reads exactly one --file` };
}

function configInvocation(command: ConfigCommand, rest: readonly string[], values: Values): InvocationResult {
	const [extra] = rest;
	if (extra !== undefined) return { reason: `unexpected argument '${extra}'` };
	const chosen = libraryOf(values);
	if ('reason' in chosen) return chosen;
	const input = inputOf(command, values);
	if ('reason' in input) return input;
	const { file: files = [], name, json, registries, project, patterns, settings } = values;
	const { library } = chosen;
	const { file } = input;
	const libraryVersion = values['library-version'];
	const invocation = {
		command,
		library,
		file,
		files,
		name,
		libraryVersion,
		registries,
		project,
		patterns,
		settings,
		json
	};
	return { invocation };
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
export function parseInvocation(argv: readonly string[]): InvocationResult {
	if (isVersionRequest(argv)) return { reason: '--version takes no arguments' };
	const parsed = parse(argv);
	if ('reason' in parsed) return parsed;
	const chosen = commandOf(parsed.positionals);
	if ('reason' in chosen) return chosen;
	const { command } = chosen;
	const reason = repeated(parsed) ?? misplaced(command, parsed.values);
	if (reason !== undefined) return { reason };
	const rest = parsed.positionals.slice(1);
	return command === 'schema' ? schemaInvocation(rest, parsed.values) : configInvocation(command, rest, parsed.values);
}
