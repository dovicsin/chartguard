import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at `moduleUrl` is the script Node was started with. Resolved paths are
 * compared because npm links bins through symlinks. `process.argv[1]` is not always a path
 * (`node -e … arg`, a REPL), so a path that cannot be resolved means "imported", not a crash.
 */
export function isEntryPoint(moduleUrl) {
	const invokedPath = process.argv[1];
	if (invokedPath === undefined) return false;
	try {
		return realpathSync(invokedPath) === fileURLToPath(moduleUrl);
	} catch {
		return false;
	}
}

/** A reader that stops early (`… | head`) closes the pipe; that is not a failure of the tool. */
function ignoreClosedPipe(error) {
	if (error.code !== 'EPIPE') throw error;
}

/**
 * Runs `main(argv)` when the module at `moduleUrl` is the script Node was started with, with a
 * closed stdout pipe tolerated, and sets the exit code from its result (a number, or nothing for 0).
 * Every tool entry point goes through here, so none can crash on `| head` again.
 */
export async function runAsEntryPoint(moduleUrl, main) {
	if (!isEntryPoint(moduleUrl)) return;
	process.stdout.on('error', ignoreClosedPipe);
	const code = await main(process.argv.slice(2));
	process.exitCode = typeof code === 'number' ? code : 0;
}
