import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkWorkspace } from '../boundaries/workspace.mjs';
import { testFiles } from '../test.mjs';

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
