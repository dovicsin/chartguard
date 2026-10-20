import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeProject, ProjectConfigError } from '../dist/project.js';

/** A project directory with the given files; removed after the test. */
function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-project-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}
const SOURCE = 'const min = 1;\nexport const config = { type: "bar", min };';
const configOf = (analysis) => ({ ...analysis.objects.find((object) => object.name === 'config').value });

test('the nearest tsconfig upward from the file is used, and the result names it', (t) => {
	const root = project(t, { 'tsconfig.json': '{ "compilerOptions": { "strict": true } }', 'src/app/x.ts': '' });
	const file = join(root, 'src/app/chart.ts');
	const analysis = analyzeProject(SOURCE, file);
	assert.equal(analysis.tsconfig, join(root, 'tsconfig.json'));
	assert.deepEqual(configOf(analysis), { type: 'bar', min: 1 });
	assert.deepEqual(analysis.diagnostics, []);
});

test('an explicit tsconfig is used as given; false uses none', (t) => {
	const root = project(t, { 'tsconfig.json': '{}', 'config/tsconfig.app.json': '{ "compilerOptions": {} }' });
	const file = join(root, 'chart.ts');
	assert.equal(
		analyzeProject(SOURCE, file, { tsconfig: join(root, 'config/tsconfig.app.json') }).tsconfig,
		join(root, 'config/tsconfig.app.json')
	);
	const none = analyzeProject(SOURCE, file, { tsconfig: false });
	assert.equal(none.tsconfig, undefined);
	assert.deepEqual(configOf(none), { type: 'bar', min: 1 });
});

test('the analysed text is the given source, not the file on disk', (t) => {
	const root = project(t, { 'tsconfig.json': '{}', 'chart.ts': 'export const config = { type: "line" };' });
	assert.deepEqual(configOf(analyzeProject(SOURCE, join(root, 'chart.ts'))), { type: 'bar', min: 1 });
});

test('extends is followed, and include patterns are never expanded', (t) => {
	const root = project(t, {
		'base.json': '{ "compilerOptions": { "target": "es2022" } }',
		'tsconfig.json': '{ "extends": "./base.json", "include": ["**/*"] }',
		'other.ts': 'syntax error here ((('
	});
	const analysis = analyzeProject(SOURCE, join(root, 'chart.ts'));
	// other.ts matches include but is not part of the analysis: only the analysed file is a root.
	assert.deepEqual(analysis.diagnostics, []);
	assert.deepEqual(configOf(analysis), { type: 'bar', min: 1 });
});

test('a malformed, invalid or missing tsconfig is refused with every problem', (t) => {
	const root = project(t, {
		'broken/tsconfig.json': '{ "compilerOptions": { ',
		'invalid/tsconfig.json': '{ "compilerOptions": { "target": "es1999", "strict": "yes" } }',
		'missing-base/tsconfig.json': '{ "extends": "./nope.json" }'
	});
	const refusal = (file, options) => {
		try {
			analyzeProject(SOURCE, file, options);
		} catch (error) {
			assert.ok(error instanceof ProjectConfigError);
			return error;
		}
		return assert.fail('expected a ProjectConfigError');
	};
	assert.ok(refusal(join(root, 'broken/chart.ts')).problems.length > 0);
	const invalid = refusal(join(root, 'invalid/chart.ts'));
	assert.equal(invalid.problems.length, 2, invalid.problems.join('\n'));
	assert.match(invalid.message, /invalid[\\/]tsconfig\.json/);
	assert.match(refusal(join(root, 'missing-base/chart.ts')).problems.join('\n'), /nope\.json/);
	assert.match(
		refusal(join(root, 'chart.ts'), { tsconfig: join(root, 'absent.json') }).problems.join('\n'),
		/absent\.json/
	);
});

test('syntax errors are reported for the analysed file, with its name and position', (t) => {
	const root = project(t, { 'tsconfig.json': '{}' });
	const file = join(root, 'chart.ts');
	const analysis = analyzeProject("const config = { type: 'bar' data: 1 };", file);
	assert.deepEqual(
		analysis.diagnostics.map((d) => [d.code, d.file, d.line, d.column]),
		[['CFG_SYNTAX', file, 1, 30]]
	);
	assert.equal(analysis.objects[0].complete, false);
});
