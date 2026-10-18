import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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

const tests = ['packages', 'apps', 'scripts', 'tools'].flatMap(findTests);
console.log('TEST', tests.length, 'files');
const { status } = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(status ?? 1);
