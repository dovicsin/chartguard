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
