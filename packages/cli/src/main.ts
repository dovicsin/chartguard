import { COMMAND_HANDLERS } from './commands.js';
import { InputError } from './errors.js';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './exit-codes.js';
import { isHelpRequest, parseInvocation } from './invocation.js';
import { type Io, processIo } from './io.js';
import { USAGE } from './usage.js';

function describeFailure(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export async function main(argv: readonly string[] = process.argv.slice(2), io: Io = processIo): Promise<number> {
	if (isHelpRequest(argv)) {
		io.out(USAGE);
		return EXIT_OK;
	}
	const invocation = parseInvocation(argv);
	if (invocation === undefined) {
		io.out(USAGE);
		return EXIT_USAGE;
	}
	try {
		return await COMMAND_HANDLERS[invocation.command](invocation, io);
	} catch (error) {
		if (error instanceof InputError) {
			io.err(`ChartGuard: ${error.message}`);
			return EXIT_USAGE;
		}
		io.err(`ChartGuard internal failure: ${describeFailure(error)}`);
		return EXIT_FAILURE;
	}
}
