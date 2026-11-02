import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeFiles, analyzeProjectFiles, ScanOptionError } from '../dist/project.js';

function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-bounds-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}
const byName = (scan) => Object.fromEntries(scan.files.map((file) => [file.fileName.split(/[\\/]/).at(-1), file]));
const codes = (analysis) => analysis.diagnostics.map((diagnostic) => diagnostic.code);

test('a scan whose Program cannot be built (a root the bracket count misses) refuses every file, never throws (E31)', async (t) => {
	const root = project(t, {
		'tsconfig.json': '{ "compilerOptions": { "jsx": "preserve" } }',
		'src/deep.tsx': `export const v = ${'<b>'.repeat(5000)}${'</b>'.repeat(5000)};`,
		'src/ok.ts': 'export const config = { type: "bar" };'
	});
	const files = byName(await analyzeProjectFiles(join(root, 'tsconfig.json')));
	for (const name of ['deep.tsx', 'ok.ts'])
		assert.deepEqual([files[name].readable, codes(files[name])], [false, ['CFG_TOO_COMPLEX']], name);
	assert.equal(files['ok.ts'].diagnostics[0].file, files['ok.ts'].fileName);
});

test('the same file named twice (a.ts, ./a.ts) is one root, and each name gets its analysis (E2)', (t) => {
	const root = project(t, { 'tsconfig.json': '{}' });
	const source = 'export const config = { type: "bar" };';
	const analyses = analyzeFiles([
		{ fileName: join(root, 'src/a.ts'), source },
		{ fileName: `${root}/src/./a.ts`, source }
	]);
	assert.deepEqual(
		analyses.map((analysis) => [analysis.readable, analysis.objects.length]),
		[
			[true, 1],
			[true, 1]
		]
	);
});

test('a file the scan cannot read from disk is listed as unreadable with its reason, never as empty', async (t) => {
	if (process.platform === 'win32' || process.getuid?.() === 0) return t.skip('permissions are not enforced here');
	const root = project(t, {
		'tsconfig.json': '{}',
		'src/locked.ts': 'export const config = { type: "bar" };',
		'src/ok.ts': 'export const config = { type: "bar" };'
	});
	chmodSync(join(root, 'src/locked.ts'), 0o000);
	const files = byName(await analyzeProjectFiles(join(root, 'tsconfig.json')));
	assert.deepEqual([files['locked.ts'].readable, codes(files['locked.ts'])], [false, ['CFG_UNREADABLE']]);
	assert.match(files['locked.ts'].diagnostics[0].message, /EACCES|permission/i);
	assert.deepEqual([files['ok.ts'].readable, files['ok.ts'].objects.length], [true, 1]);
});

test('maxFiles must be a non-negative integer: anything else is the caller input error (C1, C7)', async (t) => {
	const root = project(t, { 'tsconfig.json': '{}', 'src/ok.ts': 'export const config = {};' });
	for (const maxFiles of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2'])
		await assert.rejects(analyzeProjectFiles(join(root, 'tsconfig.json'), { maxFiles }), ScanOptionError);
	const none = await analyzeProjectFiles(join(root, 'tsconfig.json'), { maxFiles: 0 });
	assert.deepEqual([none.files.length, none.truncated], [0, true]);
});

test('a scan never reads a file outside the tsconfig directory as a project file: a symlink out, a files entry out (A36)', async (t) => {
	const outside = mkdtempSync(join(tmpdir(), 'chartguard-outside-'));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	writeFileSync(join(outside, 'secret.ts'), 'export const config = { type: "secret" };');
	writeFileSync(join(outside, 'listed.ts'), 'export const config = { type: "listed" };');
	const root = project(t, {
		'tsconfig.json': JSON.stringify({ include: ['src'], files: [join(outside, 'listed.ts')] }),
		'src/ok.ts': 'export const config = { type: "bar" };'
	});
	symlinkSync(join(outside, 'secret.ts'), join(root, 'src/linked.ts'));
	const files = byName(await analyzeProjectFiles(join(root, 'tsconfig.json')));
	for (const name of ['linked.ts', 'listed.ts']) {
		assert.deepEqual(
			[files[name].readable, codes(files[name]), files[name].objects],
			[false, ['CFG_OUTSIDE_PROJECT'], []]
		);
		assert.equal(files[name].uses.length, 0);
	}
	assert.deepEqual([files['ok.ts'].readable, files['ok.ts'].objects.length], [true, 1]);
});
