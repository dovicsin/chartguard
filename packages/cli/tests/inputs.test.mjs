import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { expandInputs, globMatcher } from '../dist/inputs.js';
import { run, sourceProject } from './helpers.mjs';

/** Several inputs, patterns and ignores (CG-06-02 part 2). */
const VALID = JSON.stringify({ type: 'bar', data: { datasets: [{ data: [1] }] } });
const INVALID = JSON.stringify({ type: 'bar', data: { datasets: [{ data: [1], borderWidth: 'wide' }] } });

/** A tree of configs, with what a walk must not enter or match. */
function tree(t) {
	const root = sourceProject(t, {
		'charts/a.json': VALID,
		'charts/b.json': INVALID,
		'charts/deep/c.json': VALID,
		'charts/deep/.hidden.json': INVALID,
		'charts/notes.txt': 'not a config',
		'charts/node_modules/pkg/x.json': INVALID,
		'other/d.json': VALID
	});
	const cwd = process.cwd();
	process.chdir(root);
	t.after(() => process.chdir(cwd));
	return root;
}

test('patterns: * within a directory, ** across them, ? one character, {a,b} alternatives; no leading dot', () => {
	const matches = (pattern, path) => globMatcher(pattern)(path);
	assert.equal(matches('charts/*.json', 'charts/a.json'), true);
	assert.equal(matches('charts/*.json', 'charts/deep/c.json'), false);
	assert.equal(matches('charts/**/*.json', 'charts/a.json'), true);
	assert.equal(matches('charts/**/*.json', 'charts/deep/c.json'), true);
	assert.equal(matches('charts/?.json', 'charts/a.json'), true);
	assert.equal(matches('charts/?.json', 'charts/ab.json'), false);
	assert.equal(matches('{charts,other}/*.json', 'other/d.json'), true);
	assert.equal(matches('charts/*.json', 'charts/.hidden.json'), false);
	assert.equal(matches('charts/**/*.json', 'charts/deep/.hidden.json'), false);
	// Regular-expression characters are literal.
	assert.equal(matches('a+b.json', 'a+b.json'), true);
	assert.equal(matches('a+b.json', 'aab.json'), false);
});

test('expansion: each file once, in code-unit order; ignores apply; node_modules and .git are never walked', async (t) => {
	tree(t);
	assert.deepEqual(await expandInputs(['charts/**/*.json'], []), [
		'charts/a.json',
		'charts/b.json',
		'charts/deep/c.json'
	]);
	assert.deepEqual(await expandInputs(['charts/**/*.json', 'charts/a.json'], ['**/deep/**']), [
		'charts/a.json',
		'charts/b.json'
	]);
	// A literal path is used as given (even one a walk would not enter), unless an ignore matches it.
	assert.deepEqual(await expandInputs(['charts/node_modules/pkg/x.json'], []), ['charts/node_modules/pkg/x.json']);
	assert.deepEqual(await expandInputs(['charts/a.json', 'other/d.json'], ['other/*']), ['charts/a.json']);
	// Code-unit order whatever order the inputs come in.
	assert.deepEqual(await expandInputs(['other/*.json', 'charts/*.json'], []), [
		'charts/a.json',
		'charts/b.json',
		'other/d.json'
	]);
	// A pattern that matches nothing is the user's input to fix.
	await assert.rejects(expandInputs(['charts/*.yaml'], []), /charts\/\*\.yaml matches no file/u);
});

test('a link to a directory is not followed by a walk', async (t) => {
	const root = tree(t);
	symlinkSync(join(root, 'other'), join(root, 'charts', 'linked'), 'dir');
	// A link named like a match but pointing at a directory is not a file; a link to a file is one.
	symlinkSync(join(root, 'other'), join(root, 'charts', 'folder.json'), 'dir');
	symlinkSync(join(root, 'other', 'd.json'), join(root, 'charts', 'alias.json'), 'file');
	assert.deepEqual(await expandInputs(['charts/**/*.json'], []), [
		'charts/a.json',
		'charts/alias.json',
		'charts/b.json',
		'charts/deep/c.json'
	]);
});

test('validate several files: grouped text, one JSON shape for a pattern, the worst exit status', async (t) => {
	tree(t);
	const text = await run(['validate', '--library', 'chartjs', '--file', 'charts/*.json']);
	assert.equal(text.code, 1);
	assert.match(
		text.out,
		/== charts\/a\.json[\s\S]*== charts\/b\.json[\s\S]*ERROR CFG_TYPE \$\.data\.datasets\[0\]\.borderWidth/u
	);
	const json = JSON.parse(
		(await run(['validate', '--library', 'chartjs', '--file', 'charts/a.json', '--file', 'other/d.json', '--json'])).out
	);
	assert.equal(json.mode, 'validate');
	assert.deepEqual(
		json.files.map(({ file, valid }) => [file, valid]),
		[
			['charts/a.json', true],
			['other/d.json', true]
		]
	);
	// A pattern that happens to match one file still gives the list shape; one literal file keeps the single shape.
	assert.equal(
		JSON.parse((await run(['validate', '--library', 'chartjs', '--file', 'other/*.json', '--json'])).out).files.length,
		1
	);
	assert.equal(
		JSON.parse((await run(['validate', '--library', 'chartjs', '--file', 'other/d.json', '--json'])).out).files,
		undefined
	);
	assert.equal(
		(await run(['validate', '--library', 'chartjs', '--file', 'charts/*.json', '--ignore', 'charts/b.json'])).code,
		0
	);
});

test('SARIF of several files is one log; a file that cannot be used is listed, the others checked, exit 2', async (t) => {
	const root = tree(t);
	const sarif = JSON.parse(
		(await run(['validate', '--library', 'chartjs', '--file', 'charts/**/*.json', '--format', 'sarif'])).out
	);
	const uris = sarif.runs[0].results.map((result) => result.locations[0].physicalLocation.artifactLocation.uri);
	assert.deepEqual([...new Set(uris)], ['charts/b.json']);
	const broken = join(root, 'charts', 'broken.json');
	(await import('node:fs')).writeFileSync(broken, '{ not json');
	const { code, out, err } = await run(['validate', '--library', 'chartjs', '--file', 'charts/*.json', '--json']);
	assert.equal(code, 2);
	assert.match(err, /charts\/broken\.json is not valid JSON/u);
	const files = JSON.parse(out).files;
	assert.deepEqual(
		files.map(({ file, error }) => [file, error === undefined]),
		[
			['charts/a.json', true],
			['charts/b.json', true],
			['charts/broken.json', false]
		]
	);
});

test('quality and analyze take patterns too; --ignore needs --file', async (t) => {
	tree(t);
	const quality = JSON.parse((await run(['quality', '--library', 'chartjs', '--file', 'charts/*.json', '--json'])).out);
	assert.deepEqual(
		quality.files.map(({ file }) => file),
		['charts/a.json', 'charts/b.json']
	);
	const { writeFileSync, mkdirSync } = await import('node:fs');
	mkdirSync('src');
	writeFileSync('src/one.ts', 'export const config = { type: "bar", data: { datasets: [] } };');
	writeFileSync(
		'src/two.ts',
		'export const config = { type: "bar", data: { datasets: [{ data: [1], borderWidth: "wide" }] } };'
	);
	const analyzed = JSON.parse((await run(['analyze', '--library', 'chartjs', '--file', 'src/*.ts', '--json'])).out);
	assert.deepEqual(
		[...new Set(analyzed.entries.map(({ file }) => file.split(/[\\/]/u).slice(-1)[0]))],
		['one.ts', 'two.ts']
	);
	const { code, err } = await run(['validate', '--library', 'chartjs', '--ignore', 'x']);
	assert.equal(code, 2);
	assert.match(err, /--file/u);
});
