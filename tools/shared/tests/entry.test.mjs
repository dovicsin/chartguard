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

test(
	'an entry point whose output is piped into a reader that stops early exits quietly',
	{ skip: process.platform === 'win32' },
	async (t) => {
		const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
		const { tmpdir } = await import('node:os');
		const { join } = await import('node:path');
		const directory = mkdtempSync(join(tmpdir(), 'entry-'));
		t.after(() => rmSync(directory, { recursive: true, force: true }));
		const script = join(directory, 'noisy.mjs');
		writeFileSync(
			script,
			`import { runAsEntryPoint } from ${JSON.stringify(ENTRY)};
		await runAsEntryPoint(import.meta.url, () => { for (let i = 0; i < 100000; i++) process.stdout.write('line\\n'); return 0; });`
		);
		const child = spawnSync('sh', ['-c', `"${process.execPath}" "${script}" | head -c 1`], { encoding: 'utf8' });
		assert.equal(child.stderr, '');
	}
);
