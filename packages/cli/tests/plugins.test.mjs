import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run, sourceProject } from './helpers.mjs';

/** Plugin schemas on the command line (CG-06-02 part 4c). Extensions are JSON data, as config-core writes schemas. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const object = (properties) => ({ kind: 'object', properties, additionalProperties: 'warn', required: [] });
const DATALABELS = {
	id: 'datalabels',
	options: {
		'chartjs.plugins': { datalabels: object({ anchor: { kind: 'string', enum: ['center', 'start', 'end'] } }) }
	}
};
const STREAMING = {
	id: 'streaming',
	variants: { 'chartjs.scales': { realtime: object({ realtime: object({ duration: { kind: 'number' } }) }) } }
};
const WORDCLOUD = {
	id: 'wordcloud',
	variants: { echarts: { 'series.wordCloud': object({ gridSize: { kind: 'number' } }) } }
};
const BAR = JSON.stringify({
	type: 'bar',
	data: { datasets: [{ data: [1] }] },
	options: {
		plugins: { datalabels: { anchor: 'middle' } },
		scales: { x: { type: 'realtime', realtime: { duration: 'long' } } }
	}
});
const codes = (out) => JSON.parse(out).diagnostics.map(({ code, path }) => `${code} ${path}`);

test('validate --plugin-schema: one extension or a list per file, every file applied; the result names them', async (t) => {
	const root = sourceProject(t, {
		'chart.json': BAR,
		'plugins/datalabels.json': JSON.stringify(DATALABELS),
		'plugins/streaming.json': JSON.stringify([STREAMING])
	});
	const chart = join(root, 'chart.json');
	const base = ['validate', '--library', 'chartjs', '--file', chart];
	assert.deepEqual(codes((await run([...base, '--json'])).out), ['CFG_UNKNOWN_VARIANT $.options.scales.x.type']);
	const plugins = [
		'--plugin-schema',
		join(root, 'plugins/datalabels.json'),
		'--plugin-schema',
		join(root, 'plugins/streaming.json')
	];
	const extended = await run([...base, ...plugins, '--json']);
	assert.equal(extended.code, 1);
	assert.deepEqual(codes(extended.out), [
		'CFG_ENUM $.options.plugins.datalabels.anchor',
		'CFG_TYPE $.options.scales.x.realtime.duration'
	]);
	assert.deepEqual(JSON.parse(extended.out).extensions, ['datalabels', 'streaming']);
	assert.match((await run([...base, ...plugins])).out, /^ {2}plugins: datalabels, streaming$/mu);
	const sarif = JSON.parse((await run([...base, ...plugins, '--format', 'sarif'])).out);
	assert.equal(sarif.runs[0].properties.extensions, 'datalabels, streaming');
});

test('echarts: a plugin series; analyze takes plugin schemas too', async (t) => {
	const root = sourceProject(t, {
		'chart.json': JSON.stringify({ series: [{ type: 'wordCloud', gridSize: 'big' }] }),
		'chart.ts': "export const config = { series: [{ type: 'wordCloud', gridSize: 'big' }] };",
		'wordcloud.json': JSON.stringify(WORDCLOUD)
	});
	const plugin = ['--plugin-schema', join(root, 'wordcloud.json')];
	const validated = await run([
		'validate',
		'--library',
		'echarts',
		'--file',
		join(root, 'chart.json'),
		...plugin,
		'--json'
	]);
	assert.deepEqual(codes(validated.out), ['CFG_TYPE $.series[0].gridSize']);
	const analyzed = JSON.parse(
		(await run(['analyze', '--library', 'echarts', '--file', join(root, 'chart.ts'), ...plugin, '--json'])).out
	);
	assert.deepEqual(
		analyzed.entries[0].result.diagnostics.map(({ code }) => code),
		['CFG_TYPE']
	);
	assert.deepEqual(analyzed.entries[0].result.extensions, ['wordcloud']);
	const sarif = await run([
		'analyze',
		'--library',
		'echarts',
		'--file',
		join(root, 'chart.ts'),
		...plugin,
		'--format',
		'sarif'
	]);
	assert.equal(JSON.parse(sarif.out).runs[0].properties.extensions, 'wordcloud');
	assert.match(
		(await run(['analyze', '--library', 'echarts', '--file', join(root, 'chart.ts'), ...plugin])).out,
		/^plugins: wordcloud$/mu
	);
});

/** A chart with plugin schema files of every kind, and a validate run with some of them. */
function refusals(t) {
	const root = sourceProject(t, {
		'chart.json': BAR,
		'built-in.json': JSON.stringify({ id: 'x', options: { 'chartjs.plugins': { legend: object({}) } } }),
		'twice.json': JSON.stringify(DATALABELS),
		'also.json': JSON.stringify({ ...DATALABELS, id: 'labels' }),
		'junk.json': JSON.stringify([{ id: 3, options: 'none' }]),
		'scalar.json': '"datalabels"',
		'list.json': '[1]',
		'broken.json': '{ not json'
	});
	const validate = (...files) =>
		run([
			'validate',
			'--library',
			'chartjs',
			'--file',
			join(root, 'chart.json'),
			...files.flatMap((file) => ['--plugin-schema', join(root, file)]),
			'--json'
		]);
	return { root, validate };
}

test('a refused extension is an input error listing every problem; a name has one owner across files', async (t) => {
	const { validate } = refusals(t);
	const refused = await validate('built-in.json');
	assert.equal(refused.code, 2);
	assert.match(refused.err, /--plugin-schema .*built-in\.json: Extensions refused:/u);
	assert.match(refused.err, /x: "legend" is a built-in option of chartjs\.plugins and cannot be replaced/u);
	assert.equal(JSON.parse(refused.out).error.kind, 'input');
	const twice = await validate('twice.json', 'built-in.json', 'also.json');
	assert.equal(twice.code, 2);
	assert.match(twice.err, /twice\.json, .*built-in\.json, .*also\.json: Extensions refused:/u);
	assert.match(twice.err, /datalabels, labels: both define "datalabels" at chartjs\.plugins/u);
	// One file given twice would be read twice: a usage error, as for --file.
	const repeated = await validate('twice.json', 'twice.json');
	assert.equal(repeated.code, 2);
	assert.match(repeated.err, /--plugin-schema .*twice\.json is given more than once/u);
});

test('a plugin schema file of something else, not JSON or missing names the file', async (t) => {
	const { validate } = refusals(t);
	for (const file of ['scalar.json', 'list.json']) {
		const other = await validate(file);
		assert.equal(other.code, 2, file);
		assert.match(
			other.err,
			new RegExp(`${file.replace('.', '\\.')} must hold an extension or a list of extensions`, 'u')
		);
	}
	const junk = await validate('junk.json');
	assert.equal(junk.code, 2);
	assert.match(junk.err, /Extensions refused/u);
	assert.doesNotMatch(junk.err, /internal failure/u);
	assert.match((await validate('broken.json')).err, /broken\.json is not valid JSON/u);
	assert.match((await validate('missing.json')).err, /Cannot read .*missing\.json/u);
});

test('a refused extension ends the run, never listed against each file among several', async (t) => {
	const { root } = refusals(t);
	const severalArgs = [
		'validate',
		'--library',
		'chartjs',
		'--file',
		join(root, 'chart.json'),
		'--file',
		join(root, 'scalar.json'),
		'--plugin-schema',
		join(root, 'built-in.json')
	];
	const several = await run([...severalArgs, '--json']);
	assert.equal(several.code, 2);
	assert.equal(JSON.parse(several.out).error.kind, 'input');
	const severalText = await run(severalArgs);
	assert.deepEqual([severalText.code, severalText.out], [2, '']);
	assert.equal(severalText.err.match(/Extensions refused/gu)?.length, 1);
});

test('--plugin-schema belongs to validate and analyze; the config file key pluginSchemas, relative to the file', async (t) => {
	const root = sourceProject(t, {
		'charts/chart.json': BAR,
		'plugins/datalabels.json': JSON.stringify(DATALABELS),
		'ci/chartguard.json': JSON.stringify({
			library: 'chartjs',
			files: ['../charts/chart.json'],
			validate: { pluginSchemas: ['../plugins/datalabels.json'] }
		})
	});
	const cwd = process.cwd();
	process.chdir(root);
	t.after(() => process.chdir(cwd));
	const quality = await run([
		'quality',
		'--library',
		'chartjs',
		'--file',
		'charts/chart.json',
		'--plugin-schema',
		'x.json'
	]);
	assert.equal(quality.code, 2);
	assert.match(quality.err, /--plugin-schema is not an option of quality/u);
	const configured = await run(['validate', '--config', 'ci/chartguard.json', '--json']);
	assert.deepEqual(JSON.parse(configured.out).extensions, ['datalabels']);
	const malformed = sourceProject(t, {
		'chartguard.config.json': JSON.stringify({ pluginSchemas: 'a.json', quality: { pluginSchemas: ['a.json'] } })
	});
	process.chdir(malformed);
	const refused = await run(['validate']);
	assert.equal(refused.code, 2);
	assert.match(refused.err, /pluginSchemas: must be a list of strings/u);
	assert.match(refused.err, /quality\.pluginSchemas: not an option of quality/u);
});

/** A Highcharts project with the repository's install linked, a chart of a plugin series and its plugin schemas. */
function highchartsProject(t) {
	const root = sourceProject(t, {
		'chart.json': JSON.stringify({ series: [{ type: 'flame3d', depth: 'deep', data: [1] }] }),
		'flame.json': JSON.stringify({
			id: 'flame3d',
			variants: { 'highcharts.series': { flame3d: { extends: 'line', schema: object({ depth: { kind: 'number' } }) } } }
		}),
		'line.json': JSON.stringify({ id: 'x', variants: { 'highcharts.series': { line: object({}) } } })
	});
	mkdirSync(join(root, 'node_modules'));
	symlinkSync(join(ROOT, 'node_modules', 'highcharts'), join(root, 'node_modules', 'highcharts'), 'dir');
	const validate = (plugin, ...extra) =>
		run([
			'validate',
			'--library',
			'highcharts',
			'--file',
			join(root, 'chart.json'),
			'--plugin-schema',
			join(root, plugin),
			...extra
		]);
	return { root, validate };
}

test('highcharts: plugin series extend the built schema; the curated subset refuses them rather than drop them', async (t) => {
	const { root, validate } = highchartsProject(t);
	const curated = await validate('flame.json');
	assert.equal(curated.code, 2);
	assert.match(
		curated.err,
		/--plugin-schema needs the full highcharts schema: run `chartguard schema build --library highcharts`/u
	);
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	const built = await validate('flame.json', '--json');
	assert.deepEqual(codes(built.out), ['CFG_TYPE $.series[0].depth']);
	assert.deepEqual(JSON.parse(built.out).extensions, ['flame3d']);
	// A refused extension over the built schema is the extension's problem, never "rebuild the schema".
	const refused = await validate('line.json');
	assert.equal(refused.code, 2);
	assert.match(refused.err, /"line" is a built-in variant of highcharts\.series/u);
	assert.doesNotMatch(refused.err, /Rebuild it/u);
});
