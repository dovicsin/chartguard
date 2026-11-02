import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openCache } from '../dist/cache.js';
import { example, run, sourceProject } from './helpers.mjs';

/** The result cache (CG-06-02 part 4d). */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const INVALID = JSON.stringify({ type: 'bar', data: { datasets: [{ data: [1], borderWidth: 'wide' }] } });
const QUALITY = readFileSync(example('chartjs-quality.json'), 'utf8');

function project(t, files = {}) {
	const root = sourceProject(t, { 'a.json': INVALID, 'q.json': QUALITY, ...files });
	return { root, cache: join(root, 'cache') };
}
const entries = (cache) => readdirSync(cache).filter((name) => name.endsWith('.json'));

/** Marks every stored result: a run that prints the mark reused it. */
function mark(cache) {
	for (const name of entries(cache)) {
		const entry = JSON.parse(readFileSync(join(cache, name), 'utf8'));
		entry.result.diagnostics = entry.result.diagnostics.map((diagnostic) => ({ ...diagnostic, message: 'CACHED' }));
		writeFileSync(join(cache, name), JSON.stringify(entry));
	}
}

test('a cached run prints exactly what a computed run prints, in every format, for validate and quality', async (t) => {
	const { root, cache } = project(t);
	for (const [command, file] of [
		['validate', 'a.json'],
		['quality', 'q.json']
	])
		for (const format of ['text', 'json', 'sarif']) {
			const args = [command, '--library', 'chartjs', '--file', join(root, file), '--format', format];
			const plain = await run(args);
			const first = await run([...args, '--cache', '--cache-location', cache]);
			const second = await run([...args, '--cache', '--cache-location', cache]);
			assert.deepEqual([first, second], [plain, plain], `${command} ${format}`);
		}
	assert.equal(entries(cache).length, 2);
	mark(cache);
	const reused = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		join(root, 'a.json'),
		'--cache',
		'--cache-location',
		cache
	]);
	assert.match(reused.out, /CACHED/u);
	assert.equal(reused.code, 1);
});

/** A project with an option file for each key part, and the runs that differ only in that part. */
function keyed(t) {
	const { root, cache } = project(t, {
		'registries.json': JSON.stringify({ 'chartjs.controllers': { names: ['bar'], complete: false } }),
		'plugin.json': JSON.stringify({
			id: 'p',
			options: { 'chartjs.plugins': { p: { kind: 'object', properties: {} } } }
		}),
		'settings.json': JSON.stringify({ rules: { 'bar-baseline': 'info' } })
	});
	const cached = ['--cache', '--cache-location', cache];
	const validate = (...extra) =>
		run(['validate', '--library', 'chartjs', '--file', join(root, 'a.json'), ...cached, ...extra]);
	const quality = (...extra) =>
		run(['quality', '--library', 'chartjs', '--file', join(root, 'q.json'), ...cached, ...extra]);
	return { root, cache, validate, quality };
}

test('each part of the key has its own entry: the options, the registries, the plugin schemas, the settings, the ruleset', async (t) => {
	const { root, cache, validate, quality } = keyed(t);
	const variants = [
		() => validate(),
		() => validate('--library-version', '4.5.0'),
		() => validate('--registries', join(root, 'registries.json')),
		() => validate('--plugin-schema', join(root, 'plugin.json')),
		() => quality(),
		() => quality('--settings', join(root, 'settings.json')),
		() => quality('--ruleset', 'misleads')
	];
	for (const variant of variants) await variant();
	assert.equal(entries(cache).length, variants.length);
	mark(cache);
	for (const variant of variants) assert.match((await variant()).out, /CACHED/u);
});

test('a changed input, option file or ruleset is computed again', async (t) => {
	const { root, cache, validate, quality } = keyed(t);
	const registries = ['--registries', join(root, 'registries.json')];
	const settings = ['--settings', join(root, 'settings.json')];
	for (const args of [[], registries]) await validate(...args);
	for (const args of [settings, ['--ruleset', 'misleads']]) await quality(...args);
	mark(cache);
	writeFileSync(join(root, 'a.json'), INVALID.replace('wide', 'wider'));
	writeFileSync(
		join(root, 'registries.json'),
		JSON.stringify({ 'chartjs.controllers': { names: ['line'], complete: false } })
	);
	writeFileSync(join(root, 'settings.json'), JSON.stringify({ rules: { 'bar-baseline': 'warning' } }));
	assert.doesNotMatch((await validate()).out, /CACHED/u);
	assert.doesNotMatch((await validate(...registries)).out, /CACHED/u);
	assert.doesNotMatch((await quality(...settings)).out, /CACHED/u);
	assert.doesNotMatch((await quality('--ruleset', 'omits')).out, /CACHED/u);
});

test('a stored entry that cannot be read, holds another key or another shape is a miss, never a result', async (t) => {
	const { root, cache } = project(t);
	const args = [
		'validate',
		'--library',
		'chartjs',
		'--file',
		join(root, 'a.json'),
		'--json',
		'--cache',
		'--cache-location',
		cache
	];
	const plain = await run(args);
	const [name] = entries(cache);
	const stored = JSON.parse(readFileSync(join(cache, name), 'utf8'));
	for (const broken of [
		'{ not json',
		// Another key: even a result of the right shape is not this file's.
		JSON.stringify({ key: 'other', result: { ...stored.result, diagnostics: [] } }),
		JSON.stringify({ ...stored, result: { ...stored.result, valid: 'no' } }),
		JSON.stringify({ ...stored, result: { ...stored.result, diagnostics: [{ code: 'X' }] } }),
		JSON.stringify({
			...stored,
			result: { ...stored.result, diagnostics: [{ code: 'X', severity: 'error', path: '$', confidence: 'certain' }] }
		})
	]) {
		writeFileSync(join(cache, name), broken);
		assert.deepEqual(await run(args), plain);
	}
});

test('a location that cannot be written is said once on stderr; the results and exit status are unchanged', async (t) => {
	const { root } = project(t, { 'b.json': INVALID.replace('wide', 'thin'), blocked: 'a file, not a directory' });
	const args = ['validate', '--library', 'chartjs', '--file', join(root, 'a.json'), '--file', join(root, 'b.json')];
	const plain = await run(args);
	const blocked = await run([...args, '--cache', '--cache-location', join(root, 'blocked', 'cache')]);
	assert.deepEqual([blocked.code, blocked.out], [plain.code, plain.out]);
	assert.equal(blocked.err.match(/ChartGuard: cache not written: /gu)?.length, 1);
});

test('--cache belongs to validate and quality; --cache-location needs --cache', async () => {
	const analyze = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts'), '--cache']);
	assert.equal(analyze.code, 2);
	assert.match(analyze.err, /--cache is not an option of analyze/u);
	const located = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		example('chartjs-invalid.json'),
		'--cache-location',
		'x'
	]);
	assert.equal(located.code, 2);
	assert.match(located.err, /--cache-location needs --cache/u);
});

test('the config file keys cache and cacheLocation, relative to the file', async (t) => {
	const { root } = project(t, {
		'ci/chartguard.json': JSON.stringify({
			library: 'chartjs',
			files: ['../a.json'],
			cache: true,
			cacheLocation: '../store'
		})
	});
	const cwd = process.cwd();
	process.chdir(root);
	t.after(() => process.chdir(cwd));
	assert.equal((await run(['validate', '--config', 'ci/chartguard.json'])).code, 1);
	assert.equal(entries(join(root, 'store')).length, 1);
	writeFileSync(join(root, 'chartguard.config.json'), JSON.stringify({ cache: 'yes', analyze: { cache: true } }));
	const refused = await run(['validate']);
	assert.equal(refused.code, 2);
	assert.match(refused.err, /cache: must be true or false/u);
	assert.match(refused.err, /analyze\.cache: not an option of analyze/u);
});

test('highcharts: the schema built from the install is part of the key, by its content', async (t) => {
	const { root, cache } = project(t, { 'h.json': JSON.stringify({ chart: { zooming: { type: 'xyz' } } }) });
	mkdirSync(join(root, 'node_modules'));
	symlinkSync(join(ROOT, 'node_modules', 'highcharts'), join(root, 'node_modules', 'highcharts'), 'dir');
	const validate = () =>
		run(['validate', '--library', 'highcharts', '--file', join(root, 'h.json'), '--cache', '--cache-location', cache]);
	await validate();
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	assert.match((await validate()).out, /ERROR CFG_ENUM/u);
	assert.equal(entries(cache).length, 2);
	mark(cache);
	assert.match((await validate()).out, /CACHED/u);
	const schema = join(root, 'node_modules/.cache/chartguard/highcharts-13.1.1.json');
	writeFileSync(schema, `${readFileSync(schema, 'utf8')}\n`);
	assert.match((await validate()).out, /ERROR CFG_ENUM .*: (?!CACHED)/u);
});

test('only a result that is plain JSON is stored: what a JSON round trip would change is computed every time (E20)', async (t) => {
	const { cache } = project(t);
	const store = await openCache(cache, { out: () => {}, err: () => {} });
	const any = (value) => value !== undefined;
	const holed = [1];
	holed[2] = 2;
	for (const [index, result] of [{ n: Number.NaN }, { n: -0 }, { list: holed }, { at: new Date(0) }].entries())
		assert.equal(await store.through({ index }, any, () => Promise.resolve(result)), result);
	assert.equal(existsSync(cache), false);
	const plain = { kept: [1, 'a', true, null], gone: undefined };
	await store.through({ plain: true }, any, () => Promise.resolve(plain));
	assert.equal(entries(cache).length, 1);
});
