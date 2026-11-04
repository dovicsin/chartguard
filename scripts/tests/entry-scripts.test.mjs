import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkWorkspace } from '../boundaries/workspace.mjs';
import { phases, testFiles } from '../test.mjs';

/**
 * The repository's own scripts find the root from `import.meta.url`, never from the working
 * directory (E7, H11): run from anywhere, they check and test this checkout.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function elsewhere(t) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-cwd-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

test('the boundary check run from another directory checks every workspace package of this checkout', (t) => {
	const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-boundaries.mjs')], {
		cwd: elsewhere(t),
		encoding: 'utf8'
	});
	assert.equal(run.status, 0, run.stderr);
	const [, count] = /\((\d+) packages\)/u.exec(run.stdout) ?? [];
	assert.ok(Number(count) >= 10, run.stdout);
});

test('a root without workspace packages is our defect, never "boundaries respected"', (t) => {
	assert.throws(() => checkWorkspace(elsewhere(t), {}), /no workspace packages/u);
});

test('the test runner finds the same test files from any working directory', (t) => {
	const listed = spawnSync(
		process.execPath,
		[
			'--input-type=module',
			'-e',
			`import(${JSON.stringify(join(ROOT, 'scripts', 'test.mjs'))}).then((m) => process.stdout.write(JSON.stringify(m.testFiles())))`
		],
		{ cwd: elsewhere(t), encoding: 'utf8' }
	);
	assert.equal(listed.status, 0, listed.stderr);
	const files = JSON.parse(listed.stdout);
	assert.deepEqual(files, testFiles());
	assert.ok(files.includes(join(ROOT, 'scripts', 'tests', 'entry-scripts.test.mjs')));
});

/** Every `*.test.mjs` under a `tests` directory at any depth, outside `node_modules` and `dist`. */
function recursiveFind(root) {
	return ['packages', 'apps', 'scripts', 'tools']
		.flatMap((top) => readdirSync(join(root, top), { recursive: true }).map((path) => join(root, top, path)))
		.filter((path) => path.endsWith('.test.mjs'))
		.filter((path) => {
			const segments = path.slice(root.length).split(sep);
			const below = segments.slice(0, -1);
			return below.includes('tests') && !below.includes('node_modules') && !below.includes('dist');
		})
		.sort();
}

test('the test runner runs every test file under tests/, nested ones too', (t) => {
	const root = elsewhere(t);
	const files = [
		'packages/a/tests/top.test.mjs',
		'packages/a/tests/nested/deep.test.mjs',
		'apps/b/tests/x/y/z.test.mjs'
	];
	for (const directory of ['packages', 'apps', 'scripts', 'tools']) mkdirSync(join(root, directory));
	for (const file of [...files, 'packages/a/tests/fixtures/data.json', 'packages/a/node_modules/m/tests/no.test.mjs']) {
		mkdirSync(join(root, file, '..'), { recursive: true });
		writeFileSync(join(root, file), '');
	}
	assert.deepEqual(testFiles(root).sort(), files.map((file) => join(root, file)).sort());
	assert.deepEqual(testFiles().sort(), recursiveFind(ROOT));
});

test('the files that measure time run alone after all the others; every file runs exactly once (E84)', () => {
	const tests = testFiles();
	const [parallel, alone] = phases(tests);
	assert.deepEqual(alone, [join(ROOT, 'tools', 'benchmarks', 'tests', 'budgets.test.mjs')]);
	assert.deepEqual([...parallel, ...alone].sort(), [...tests].sort());
	assert.equal(new Set([...parallel, ...alone]).size, tests.length);
});
