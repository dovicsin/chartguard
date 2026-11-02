import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { run, sourceProject } from './helpers.mjs';

/** A project config file and its precedence (CG-06-02 part 3). */
const VALID = JSON.stringify({ type: 'bar', data: { datasets: [{ data: [1] }] } });
const INVALID = JSON.stringify({ type: 'bar', data: { datasets: [{ data: [1], borderWidth: 'wide' }] } });

/** A project with a config file and charts, as the working directory for the test. */
function project(t, config, files = {}) {
	const root = sourceProject(t, {
		'charts/a.json': VALID,
		'charts/b.json': INVALID,
		...(config === undefined ? {} : { 'chartguard.config.json': JSON.stringify(config) }),
		...files
	});
	const cwd = process.cwd();
	process.chdir(root);
	t.after(() => process.chdir(cwd));
	return root;
}

test('chartguard.config.json in the working directory supplies the options the command line leaves out', async (t) => {
	project(t, { library: 'chartjs', files: ['charts/*.json'] });
	const { code, out } = await run(['validate']);
	assert.equal(code, 1);
	assert.match(out, /^Settings from chartguard\.config\.json\./u);
	assert.match(out, /== charts\/b\.json/u);
});

test('precedence: the command line, then the command section, then the top level', async (t) => {
	project(t, {
		library: 'chartjs',
		files: ['charts/*.json'],
		failOn: 'never',
		validate: { ignore: ['charts/a.json'], format: 'json' }
	});
	// The section's ignore and format apply; the top level's failOn too.
	const fromFile = await run(['validate']);
	assert.equal(fromFile.code, 0);
	assert.deepEqual(
		JSON.parse(fromFile.out).files.map(({ file }) => file),
		['charts/b.json']
	);
	// The command line replaces them: --file replaces files (and the ignore still applies), --fail-on replaces failOn.
	const fromLine = await run(['validate', '--file', 'charts/a.json', '--fail-on', 'error', '--format', 'text']);
	assert.equal(fromLine.code, 2);
	assert.match(fromLine.err, /every --file is left out by --ignore/u);
	assert.equal((await run(['validate', '--ignore', 'none', '--fail-on', 'error', '--json'])).code, 1);
	// The quality command does not see the validate section.
	assert.equal(JSON.parse((await run(['quality', '--json'])).out).files.length, 2);
});

test('--config names another file, whose paths are relative to it; --no-config reads none', async (t) => {
	const root = project(t, undefined, {
		'ci/chartguard.json': JSON.stringify({ library: 'chartjs', files: ['../charts/a.json'], format: 'sarif' })
	});
	const { code, out } = await run(['validate', '--config', 'ci/chartguard.json']);
	assert.equal(code, 0);
	const log = JSON.parse(out);
	assert.equal(log.runs[0].properties.config, 'ci/chartguard.json');
	const missing = await run(['validate', '--config', join(root, 'none.json')]);
	assert.equal(missing.code, 2);
	assert.match(missing.err, /none\.json/u);
	const ignored = await run(['validate', '--no-config']);
	assert.equal(ignored.code, 2);
	assert.match(ignored.err, /--library is required/u);
	assert.equal((await run(['validate', '--config', 'ci/chartguard.json', '--no-config'])).code, 2);
});

test('a malformed config file is an input error listing every problem with its key', async (t) => {
	project(t, {
		library: 'd3',
		files: 'charts/*.json',
		format: 'xml',
		color: 'red',
		quality: { name: 'config', failOn: 1 }
	});
	const { code, err } = await run(['validate']);
	assert.equal(code, 2);
	for (const problem of [
		/library: unknown library 'd3'/u,
		/files: must be a list of strings/u,
		/format: unknown format 'xml'/u,
		/color: unknown key/u,
		/quality\.name: not an option of quality/u,
		/quality\.failOn: must be a string/u
	])
		assert.match(err, problem);
	const json = await run(['validate', '--json']);
	assert.equal(JSON.parse(json.out).error.kind, 'input');
});

test('a config file that is not a JSON object is an input error; schema build reads none', async (t) => {
	project(t, undefined, { 'chartguard.config.json': '[1, 2]' });
	const { code, err } = await run(['validate', '--library', 'chartjs', '--file', 'charts/a.json']);
	assert.equal(code, 2);
	assert.match(err, /chartguard\.config\.json must hold a JSON object/u);
});

test('a key in both the top level and the command section: the section wins; --no-config skips the default file', async (t) => {
	project(t, { library: 'chartjs', files: ['charts/a.json'], format: 'text', validate: { format: 'json' } });
	assert.equal(JSON.parse((await run(['validate'])).out).mode, 'validate');
	const skipped = await run(['validate', '--no-config']);
	assert.equal(skipped.code, 2);
	assert.match(skipped.err, /--library is required/u);
});
