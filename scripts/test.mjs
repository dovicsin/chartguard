import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/** This checkout, wherever the script is run from (E7). */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules']);

function findTests(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.name !== 'tests') return findTests(path);
			return readdirSync(path)
				.filter((file) => file.endsWith('.test.mjs'))
				.map((file) => join(path, file));
		});
}

/** Every test file of the checkout, as absolute paths. */
export function testFiles() {
	return ['packages', 'apps', 'scripts', 'tools'].flatMap((directory) => findTests(join(ROOT, directory)));
}

function main() {
	const tests = testFiles();
	console.log('TEST', tests.length, 'files');
	const { status } = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', cwd: ROOT });
	return status ?? 1;
}

await runAsEntryPoint(import.meta.url, main);
