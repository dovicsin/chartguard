import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/** This checkout, wherever the script is run from (E7). */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Runs a Node script of this checkout from its root; its exit status. */
const node = (...args) => spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT }).status ?? 1;

/** `<package>/dist/generated/<name>.json`, compared by path segments so the separator does not matter. */
function isShippedArtifact(path) {
	const parent = dirname(path);
	return path.endsWith('.json') && basename(parent) === 'generated' && basename(dirname(parent)) === 'dist';
}

/** tsc re-indents emitted JSON; shipped schema artifacts carry no whitespace. */
function compactGeneratedArtifacts(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && entry.name !== 'node_modules') compactGeneratedArtifacts(path);
		else if (isShippedArtifact(path)) writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))));
	}
}

function main() {
	const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
	// Project references in tsconfig.json define the build order.
	const built = node(tsc, '-b', join(ROOT, 'tsconfig.json'));
	if (built !== 0) return built;
	compactGeneratedArtifacts(join(ROOT, 'packages'));
	// Schema artifacts that may not be committed (Highcharts) are generated locally from the installed
	// package on every build, so tests and the CLI find them in this checkout.
	const local = node(join(ROOT, 'tools', 'schema-generator', 'generate.mjs'), 'write', 'highcharts');
	if (local !== 0) return local;
	// The playground bundle needs the compiled packages above.
	const playground = node(join(ROOT, 'apps', 'playground', 'scripts', 'build.mjs'));
	if (playground !== 0) return playground;
	console.log('Build successful; CLI is native ESM.');
	return 0;
}

await runAsEntryPoint(import.meta.url, main);
