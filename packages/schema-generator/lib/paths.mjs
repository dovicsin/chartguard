import { join } from 'node:path';

/**
 * Where schemas that may not be redistributed (Highcharts) are written: under the project's own
 * node_modules, so never tracked by git and never inside a package's `files`. A module of its own,
 * so tools that only look a schema up (the CLI) do not load the generator and the TypeScript compiler.
 */
export const LOCAL_ARTIFACTS = 'node_modules/.cache/chartguard';

/**
 * The schema built for `library` at `version` in the project at `root`.
 * @param {string} root
 * @param {string} library
 * @param {string} version
 * @returns {string}
 */
export function localSchemaPath(root, library, version) {
	return join(root, LOCAL_ARTIFACTS, `${library}-${version}.json`);
}
