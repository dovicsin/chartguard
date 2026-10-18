#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { main } from '../dist/index.js';

export { main };

/**
 * npm links bins through symlinks, so resolved paths are compared. `process.argv[1]` is not
 * always a path (`node -e`, a REPL); then this module was imported, not run.
 */
function isEntryPoint() {
	const invokedPath = process.argv[1];
	if (invokedPath === undefined) return false;
	try {
		return realpathSync(invokedPath) === fileURLToPath(import.meta.url);
	} catch {
		return false;
	}
}

/** A reader that stops early (`chartguard … | head`) closes the pipe; that is not a failure. */
function ignoreClosedPipe(error) {
	if (error.code !== 'EPIPE') throw error;
}

if (isEntryPoint()) {
	process.stdout.on('error', ignoreClosedPipe);
	process.exitCode = await main();
}
