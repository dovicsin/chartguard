import { parseArgs } from 'node:util';

import { isLibrary, type Library } from './libraries.js';

const CONFIG_COMMANDS = ['validate', 'quality', 'analyze'] as const;
export type ConfigCommand = (typeof CONFIG_COMMANDS)[number];

/** `validate`, `quality` or `analyze` one input file. */
export interface ConfigInvocation {
	readonly command: ConfigCommand;
	readonly library: Library;
	readonly file: string;
	readonly name: string | undefined;
	/** An exact version, `auto` (the installed package), or undefined: no claim about the user's install. */
	readonly libraryVersion: string | undefined;
	/** A JSON file with the registry context: what the user's runtime has registered. */
	readonly registries: string | undefined;
	/** `analyze`: the tsconfig to build the Program with; undefined discovers the nearest one. */
	readonly project: string | undefined;
	/** `analyze`: a JSON list of the project's own chart wrappers (CG-03-06). */
	readonly patterns: string | undefined;
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
	file: { type: 'string' },
	name: { type: 'string' },
	'library-version': { type: 'string' },
	registries: { type: 'string' },
	project: { type: 'string' },
	patterns: { type: 'string' },
	dir: { type: 'string' },
	json: { type: 'boolean', default: false }
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>['values'];

const HELP_WORDS: ReadonlySet<string> = new Set(['help', '--help', '-h']);

function isConfigCommand(value: string | undefined): value is ConfigCommand {
	return CONFIG_COMMANDS.some((command) => command === value);
}

export function isHelpRequest(argv: readonly string[]): boolean {
	const [first] = argv;
	return first === undefined || HELP_WORDS.has(first);
}

/** `--name` and `--project` belong to `analyze`; `--library-version` and `--registries` to the config checks, not to `quality`. */
function misplaced(command: ConfigCommand, values: Values): boolean {
	const { name, registries, project, patterns, 'library-version': libraryVersion } = values;
	const context = libraryVersion !== undefined || registries !== undefined;
	const source = name !== undefined || project !== undefined || patterns !== undefined;
	return (source && command !== 'analyze') || (context && command === 'quality');
}

function configInvocation(
	command: ConfigCommand,
	rest: readonly string[],
	values: Values
): ConfigInvocation | undefined {
	const { library, file, name, json, registries, project, patterns, dir, 'library-version': libraryVersion } = values;
	if (rest.length > 0 || library === undefined || file === undefined || dir !== undefined) return undefined;
	if (!isLibrary(library) || misplaced(command, values)) return undefined;
	return { command, library, file, name, libraryVersion, registries, project, patterns, json };
}

/** `schema build --library <library> [--dir <project>] [--json]`, and nothing else. */
function schemaInvocation(rest: readonly string[], values: Values): SchemaInvocation | undefined {
	const { library, dir, json, file, name, registries, project, patterns, 'library-version': libraryVersion } = values;
	const foreign = [file, name, registries, project, patterns, libraryVersion].some((value) => value !== undefined);
	if (rest.length !== 1 || rest[0] !== 'build' || foreign || library === undefined || !isLibrary(library))
		return undefined;
	return { command: 'schema', library, directory: dir ?? '.', json };
}

/** Returns undefined for any malformed invocation. */
export function parseInvocation(argv: readonly string[]): Invocation | undefined {
	try {
		const { positionals, values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
		const [command, ...rest] = positionals;
		if (command === 'schema') return schemaInvocation(rest, values);
		return isConfigCommand(command) ? configInvocation(command, rest, values) : undefined;
	} catch {
		return undefined;
	}
}
