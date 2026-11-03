import { COMMAND_HANDLERS } from './commands.js';
import { type ProjectConfig, readProjectConfig } from './config-file.js';
import { InputError } from './errors.js';
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from './exit-codes.js';
import { type Invocation, isHelpRequest, isVersionRequest, parseInvocation, wantsJson } from './invocation.js';
import { type Io, processIo } from './io.js';
import { printJson } from './report.js';
import { schemaCommand } from './schema.js';
import { USAGE, USAGE_HINT } from './usage.js';
import { cliVersion } from './version.js';

function describeFailure(error: unknown): string {
	return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * The user's arguments or input cannot be used (exit 2): the reason on stderr; with `--json`, also
 * `{ "error": { "kind", "message" } }` on stdout, so stdout stays one JSON document.
 */
function userError(kind: 'usage' | 'input', message: string, json: boolean, io: Io): number {
	io.err(`ChartGuard: ${message}`);
	if (kind === 'usage') io.err(USAGE_HINT);
	if (json) printJson({ error: { kind, message } }, io);
	return EXIT_USAGE;
}

async function execute(invocation: Invocation, io: Io): Promise<number> {
	try {
		if (invocation.command === 'schema') return await schemaCommand(invocation, io);
		return await COMMAND_HANDLERS[invocation.command](invocation, io);
	} catch (error) {
		if (error instanceof InputError) return userError('input', error.message, invocation.json, io);
		io.err(`ChartGuard internal failure: ${describeFailure(error)}`);
		return EXIT_FAILURE;
	}
}

/**
 * Runs one CLI invocation and resolves to its exit code: 0, 1 when the findings fail it under
 * `--fail-on` (a confirmed error by default), 2 for unusable arguments or input, 3 for an internal
 * failure. Prints only through `io`; never calls `process.exit`.
 */
export async function main(argv: readonly string[] = process.argv.slice(2), io: Io = processIo): Promise<number> {
	if (isHelpRequest(argv)) {
		io.out(USAGE);
		return EXIT_OK;
	}
	if (isVersionRequest(argv) && argv.length === 1) {
		io.out(cliVersion());
		return EXIT_OK;
	}
	let config: ProjectConfig | undefined;
	try {
		// A check reads the project's config file first (CG-06-02 part 3); schema build reads none.
		if (argv[0] !== 'schema') config = await readProjectConfig(argv);
	} catch (error) {
		if (error instanceof InputError) return userError('input', error.message, wantsJson(argv), io);
		throw error;
	}
	const parsed = parseInvocation(argv, config);
	if ('reason' in parsed) return userError('usage', parsed.reason, wantsJson(argv), io);
	return execute(parsed.invocation, io);
}
