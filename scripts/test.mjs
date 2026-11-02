import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';

/** This checkout, wherever the script is run from (E7). */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIPPED_DIRECTORIES = new Set(['dist', 'node_modules']);

/** Every `*.test.mjs` at any depth below `directory`. */
function allTests(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => !SKIPPED_DIRECTORIES.has(entry.name))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return allTests(path);
			return entry.isFile() && entry.name.endsWith('.test.mjs') ? [path] : [];
		});
}

/** The test files of every `tests` directory below `directory`, nested ones included (knip reads `tests/**`). */
function findTests(directory) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			return entry.name === 'tests' ? allTests(path) : findTests(path);
		});
}

/** Every test file of the checkout (or of another root, for the runner's own test), as absolute paths. */
export function testFiles(root = ROOT) {
	return ['packages', 'apps', 'scripts', 'tools'].flatMap((directory) => findTests(join(root, directory)));
}

function main() {
	const tests = testFiles();
	console.log('TEST', tests.length, 'files');
	const { status } = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit', cwd: ROOT });
	return status ?? 1;
}

await runAsEntryPoint(import.meta.url, main);
