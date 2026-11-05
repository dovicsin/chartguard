import { join } from 'node:path';

// Imported, never read from beside this file: bundles (the VS Code extension's server) hold this module without them.
import GENERATOR from '../package.json' with { type: 'json' };
import PINS from '../upstream-sources.json' with { type: 'json' };

const COMPILER = PINS.compiler;

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

const text = (value) => (typeof value === 'string' ? value : undefined);

/** `@chartguard/schema-generator 0.1.0 with typescript@5.9.3`, as a schema's header records it. */
function builder(header) {
	const generator = header.generator !== null && typeof header.generator === 'object' ? header.generator : {};
	const sources = header.sources !== null && typeof header.sources === 'object' ? header.sources : {};
	const compiler = sources.typescript !== null && typeof sources.typescript === 'object' ? sources.typescript : {};
	const name = text(generator.name) ?? 'an unnamed generator';
	const version = text(generator.version) ?? 'of no recorded version';
	return `${name} ${version} with ${text(compiler.locator) ?? 'no recorded compiler'}`;
}

/**
 * Why a schema built on the user's machine cannot be used by this ChartGuard, or `undefined` when its
 * own generator built it with its own compiler: another generator or TypeScript reads the same install
 * differently, so its schema is rebuilt, never used as if it were this one's (CG-07-06).
 * @param {unknown} artifact the parsed schema file
 * @returns {string | undefined}
 */
export function otherBuild(artifact) {
	const built = builder(artifact !== null && typeof artifact === 'object' ? artifact : {});
	const ours = `${GENERATOR.name} ${GENERATOR.version} with typescript@${COMPILER.version}`;
	return built === ours ? undefined : `it was built by ${built}; this ChartGuard builds with ${ours}`;
}
