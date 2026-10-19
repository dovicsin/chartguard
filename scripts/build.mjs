import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

// Project references in tsconfig.json define the build order.
const { status } = spawnSync(process.execPath, [tsc, '-b', 'tsconfig.json'], { stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);

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

compactGeneratedArtifacts('packages');

// Schema artifacts that may not be committed (Highcharts) are generated locally from the installed
// package on every build, so tests and the CLI find them in this checkout.
const local = spawnSync(process.execPath, ['tools/schema-generator/generate.mjs', 'write', 'highcharts'], {
	stdio: 'inherit'
});
if (local.status !== 0) process.exit(local.status ?? 1);

// The playground bundle needs the compiled packages above.
const playground = spawnSync(process.execPath, ['apps/playground/scripts/build.mjs'], { stdio: 'inherit' });
if (playground.status !== 0) process.exit(playground.status ?? 1);
console.log('Build successful; CLI is native ESM.');
