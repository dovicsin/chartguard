import { COMMAND_HANDLERS } from './commands.js';
import { EXIT_OK, EXIT_USAGE } from './exit-codes.js';
import { isHelpRequest, parseInvocation } from './invocation.js';
import { type Io, processIo } from './io.js';
import { USAGE } from './usage.js';

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
		io.err(`ChartGuard: ${error instanceof Error ? error.message : String(error)}`);
		return EXIT_USAGE;
	}
}
