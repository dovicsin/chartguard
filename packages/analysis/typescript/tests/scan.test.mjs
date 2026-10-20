import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeFiles, analyzeProject, analyzeProjectFiles } from '../dist/project.js';

function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-scan-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}
const json = (value) => JSON.parse(JSON.stringify(value ?? null));
const THEME = 'export const theme = { color: "red", size: 2 };';
const DARK = 'import { theme } from "./theme";\ntheme.color = "white";';
const CHART =
	'import { Chart } from "chart.js";\nimport { theme } from "./theme";\nnew Chart(ctx, { options: theme });';

test("files analysed together see each other's writes; one file alone cannot see an importer", (t) => {
	const root = project(t, { 'tsconfig.json': '{}', 'src/theme.ts': THEME, 'src/dark.ts': DARK });
	const alone = analyzeProject(CHART, join(root, 'src/chart.ts'));
	assert.deepEqual(json(alone.uses[0].value), { options: { color: 'red', size: 2 } });
	const together = analyzeFiles([
		{ fileName: join(root, 'src/chart.ts'), source: CHART },
		{ fileName: join(root, 'src/dark.ts'), source: DARK }
	]);
	assert.deepEqual(
		together.map((analysis) => analysis.fileName),
		[join(root, 'src/chart.ts'), join(root, 'src/dark.ts')]
	);
	assert.deepEqual([together[0].uses[0].complete, json(together[0].uses[0].value)], [false, { options: { size: 2 } }]);
	assert.deepEqual(analyzeFiles([]), []);
});

test('a project scan reads every file the tsconfig includes, in one Program, and says when it stopped early', async (t) => {
	const root = project(t, {
		'tsconfig.json': '{ "include": ["src"] }',
		'src/theme.ts': THEME,
		'src/dark.ts': DARK,
		'src/chart.ts': CHART,
		'src/types.d.ts': 'export declare const x: number;',
		'other/ignored.ts': 'export const config = {};'
	});
	const scan = await analyzeProjectFiles(join(root, 'tsconfig.json'));
	assert.deepEqual(scan.files.map((file) => file.fileName.slice(root.length + 1).replaceAll('\\', '/')).sort(), [
		'src/chart.ts',
		'src/dark.ts',
		'src/theme.ts'
	]);
	assert.equal(scan.truncated, false);
	const chart = scan.files.find((file) => file.fileName.endsWith('chart.ts'));
	assert.deepEqual(json(chart.uses[0].value), { options: { size: 2 } });
	const limited = await analyzeProjectFiles(join(root, 'tsconfig.json'), { maxFiles: 1 });
	assert.deepEqual([limited.files.length, limited.truncated], [1, true]);
});

test('a scan can be cancelled, also while it runs, and concurrent scans do not disturb each other', async (t) => {
	const files = {
		'tsconfig.json': '{}',
		...Object.fromEntries(
			Array.from({ length: 30 }, (_, index) => [
				`src/f${String(index)}.ts`,
				`export const config${String(index)} = { v: ${String(index)} };`
			])
		)
	};
	const root = project(t, files);
	const tsconfig = join(root, 'tsconfig.json');
	const aborted = new AbortController();
	aborted.abort(new Error('stop'));
	await assert.rejects(analyzeProjectFiles(tsconfig, { signal: aborted.signal }), { message: 'stop' });
	const midway = new AbortController();
	const cancelled = analyzeProjectFiles(tsconfig, { signal: midway.signal });
	const other = analyzeProjectFiles(tsconfig);
	setTimeout(() => midway.abort(new Error('midway')), 1);
	await assert.rejects(cancelled, { message: 'midway' });
	const [one, two] = await Promise.all([other, analyzeProjectFiles(tsconfig)]);
	assert.equal(one.files.length, 30);
	assert.deepEqual(
		json(one.files.map((file) => file.objects.map((object) => object.value))),
		json(two.files.map((file) => file.objects.map((object) => object.value)))
	);
});

test('a file the scan cannot read is refused with a note; the others are still read', async (t) => {
	const root = project(t, {
		'tsconfig.json': '{}',
		'src/deep.ts': `export const config = ${'['.repeat(300)}${']'.repeat(300)};`,
		'src/ok.ts': 'export const config = { type: "bar" };'
	});
	const scan = await analyzeProjectFiles(join(root, 'tsconfig.json'));
	const byName = Object.fromEntries(
		scan.files.map((file) => [file.fileName.endsWith('deep.ts') ? 'deep' : 'ok', file])
	);
	assert.deepEqual([byName.deep.readable, byName.deep.diagnostics.map((d) => d.code)], [false, ['CFG_TOO_COMPLEX']]);
	assert.deepEqual([byName.ok.readable, byName.ok.objects.length], [true, 1]);
});

test('a value is never read from a file with syntax errors, even when that file is analysed too', (t) => {
	const root = project(t, { 'tsconfig.json': '{}' });
	// The declaration itself parses; the error is elsewhere in the file, so the recovered tree still holds it.
	const broken = 'export const theme = { color: "red" };\nconst other = (;';
	const chart = 'import { theme } from "./theme";\nexport const config = { theme, kept: 1 };';
	const [read, themed] = analyzeFiles([
		{ fileName: join(root, 'src/chart.ts'), source: chart },
		{ fileName: join(root, 'src/theme.ts'), source: broken }
	]);
	const config = read.objects.find((object) => object.name === 'config');
	assert.deepEqual([config.complete, json(config.value)], [false, { kept: 1 }]);
	assert.equal(themed.readable, false);
});

test("given texts import each other even when they are not on disk yet: an editor's buffers", (t) => {
	const root = project(t, { 'tsconfig.json': '{}' });
	const [chart] = analyzeFiles([
		{
			fileName: join(root, 'src/chart.ts'),
			source: 'import { theme } from "./theme";\nexport const config = { theme };'
		},
		{ fileName: join(root, 'src/theme.ts'), source: 'export const theme = { color: "red" };' }
	]);
	const config = chart.objects.find((object) => object.name === 'config');
	assert.deepEqual([config.complete, json(config.value)], [true, { theme: { color: 'red' } }]);
});
