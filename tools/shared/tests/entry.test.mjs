import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { isEntryPoint } from '../entry.mjs';

const ENTRY = new URL('../entry.mjs', import.meta.url).href;

test('a module that was imported is not the entry point', () => assert.equal(isEntryPoint(ENTRY), false));

test('argv that is not a path means "imported", not a crash', () => {
	const script = `const { isEntryPoint } = await import(${JSON.stringify(ENTRY)});
		process.stdout.write(String(isEntryPoint(${JSON.stringify(ENTRY)})));`;
	const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, 'no/such/file'], {
		encoding: 'utf8'
	});
	assert.deepEqual([child.status, child.stdout, child.stderr], [0, 'false', '']);
});
