import { parseArgs } from 'node:util';

import { isLibrary, type Library } from './libraries.js';

const COMMANDS = ['validate', 'quality', 'analyze'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Invocation {
	readonly command: Command;
	readonly library: Library;
	readonly file: string;
	readonly name: string | undefined;
	/** An exact version, `auto` (the installed package), or undefined: no claim about the user's install. */
	readonly libraryVersion: string | undefined;
	/** A JSON file with the registry context: what the user's runtime has registered. */
	readonly registries: string | undefined;
	readonly json: boolean;
}

const OPTIONS = {
	library: { type: 'string' },
	file: { type: 'string' },
	name: { type: 'string' },
	'library-version': { type: 'string' },
	registries: { type: 'string' },
	json: { type: 'boolean', default: false }
} as const;

const HELP_WORDS: ReadonlySet<string> = new Set(['help', '--help', '-h']);

function isCommand(value: string | undefined): value is Command {
	return COMMANDS.some((command) => command === value);
}

export function isHelpRequest(argv: readonly string[]): boolean {
	const [first] = argv;
	return first === undefined || HELP_WORDS.has(first);
}

/** `--name` belongs to `analyze`; `--library-version` and `--registries` to the config checks, not to `quality`. */
function misplaced(
	command: Command,
	name: string | undefined,
	contextOptions: readonly (string | undefined)[]
): boolean {
	const context = contextOptions.some((value) => value !== undefined);
	return (name !== undefined && command !== 'analyze') || (context && command === 'quality');
}

/** Returns undefined for any malformed invocation. */
export function parseInvocation(argv: readonly string[]): Invocation | undefined {
	try {
		const { positionals, values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
		const [command, ...rest] = positionals;
		const { library, file, name, json, registries, 'library-version': libraryVersion } = values;
		if (!isCommand(command) || rest.length > 0 || library === undefined || file === undefined) return undefined;
		if (!isLibrary(library) || misplaced(command, name, [libraryVersion, registries])) return undefined;
		return { command, library, file, name, libraryVersion, registries, json };
	} catch {
		return undefined;
	}
}
