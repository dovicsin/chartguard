import { parseArgs } from 'node:util';

import { isLibrary, type Library } from './libraries.js';

const COMMANDS = ['validate', 'quality', 'analyze'] as const;
export type Command = (typeof COMMANDS)[number];

export interface Invocation {
	readonly command: Command;
	readonly library: Library;
	readonly file: string;
	readonly name: string | undefined;
	readonly json: boolean;
}

const OPTIONS = {
	library: { type: 'string' },
	file: { type: 'string' },
	name: { type: 'string' },
	json: { type: 'boolean', default: false }
} as const;

function isCommand(value: string | undefined): value is Command {
	return COMMANDS.some((command) => command === value);
}

export function isHelpRequest(argv: readonly string[]): boolean {
	const [first] = argv;
	return first === undefined || first === 'help' || first === '--help';
}

/** Returns undefined for any malformed invocation. */
export function parseInvocation(argv: readonly string[]): Invocation | undefined {
	try {
		const { positionals, values } = parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
		const [command] = positionals;
		const { library, file, name, json } = values;
		if (!isCommand(command) || library === undefined || file === undefined || !isLibrary(library)) return undefined;
		return { command, library, file, name, json };
	} catch {
		return undefined;
	}
}
