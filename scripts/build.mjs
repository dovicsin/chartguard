import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

// Project references in tsconfig.json define the build order.
const { status } = spawnSync(process.execPath, [tsc, '-b', 'tsconfig.json'], { stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);

/** tsc re-indents emitted JSON; shipped schema artifacts carry no whitespace. */
function compactGeneratedArtifacts(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory() && entry.name !== 'node_modules') compactGeneratedArtifacts(path);
		else if (entry.name.endsWith('.json') && path.includes('/dist/generated/'))
			writeFileSync(path, JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))));
	}
}

compactGeneratedArtifacts('packages');
console.log('Build successful; CLI is native ESM.');
