import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';
import { guard, report } from './memory-guard.mjs';

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

/** Runs every test file, each process bounded in memory (E80); a process the bound stopped fails the run. */
async function main() {
	const tests = testFiles();
	console.log('TEST', tests.length, 'files');
	const child = spawn(process.execPath, ['--test', ...tests], { stdio: 'inherit', cwd: ROOT });
	const watch = guard(child.pid);
	const [status] = await once(child, 'exit');
	const seen = watch.stop();
	for (const line of report(watch, seen)) console.error(line);
	return seen.killed.length > 0 ? 1 : (status ?? 1);
}

await runAsEntryPoint(import.meta.url, main);
