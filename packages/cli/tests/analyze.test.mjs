import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { run, sourceProject } from './helpers.mjs';

const CHART =
	'const size = 2;\nexport const config = { type: "bar", data: { datasets: [] }, options: { responsive: size } };';

test('analyze reads the file with the nearest tsconfig and says which; --project names another', async (t) => {
	const root = sourceProject(t, { 'tsconfig.json': '{}', 'other/tsconfig.json': '{}', 'src/chart.ts': CHART });
	const file = join(root, 'src/chart.ts');
	const found = await run(['analyze', '--library', 'chartjs', '--file', file]);
	assert.match(found.out, new RegExp(`^Read with ${join(root, 'tsconfig.json').replaceAll('\\', '\\\\')}\\.$`, 'm'));
	assert.equal(found.code, 1);
	assert.match(found.out, /error: \$\.options\.responsive/);
	const named = await run([
		'analyze',
		'--library',
		'chartjs',
		'--file',
		file,
		'--project',
		join(root, 'other/tsconfig.json'),
		'--json'
	]);
	assert.deepEqual(JSON.parse(named.out).project, { tsconfig: join(root, 'other/tsconfig.json') });
});

test('an unusable tsconfig is an input error (exit 2) naming the file and the problem', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{ "compilerOptions": { "target": "es1999" } }',
		'chart.ts': CHART
	});
	const { code, err } = await run(['analyze', '--library', 'chartjs', '--file', join(root, 'chart.ts')]);
	assert.equal(code, 2);
	assert.match(err, /Cannot use .*tsconfig\.json/);
	assert.match(err, /target/);
	const missing = await run([
		'analyze',
		'--library',
		'chartjs',
		'--file',
		join(root, 'chart.ts'),
		'--project',
		join(root, 'nope.json')
	]);
	assert.equal(missing.code, 2);
});

test('--project belongs to analyze only', async () => {
	for (const command of ['validate', 'quality'])
		assert.equal(
			(await run([command, '--library', 'chartjs', '--file', 'x.json', '--project', 'tsconfig.json'])).code,
			2,
			command
		);
	assert.equal((await run(['schema', 'build', '--library', 'highcharts', '--project', 'tsconfig.json'])).code, 2);
});

test('analyze validates values imported from other project files', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		'src/options.ts': 'export const options = { responsive: "yes" };',
		'src/index.ts': 'export { options as sharedOptions } from "./options";',
		'src/chart.ts':
			'import { sharedOptions } from ".";\nexport const config = { type: "bar", data: { datasets: [] }, options: sharedOptions };'
	});
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', join(root, 'src/chart.ts'), '--json']);
	assert.equal(code, 1);
	const [entry] = JSON.parse(out).entries;
	assert.equal(entry.complete, true);
	assert.deepEqual(
		entry.result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`),
		['CFG_TYPE $.options.responsive']
	);
});

test('analyze validates the configs the file hands to the library, named or inline', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		'src/chart.ts': [
			'import { Chart } from "chart.js";',
			'const options = { responsive: "yes" };',
			'new Chart(a, { type: "bar", data: { datasets: [] }, options });',
			'const bad = { type: "pie", data: 5 };',
			'new Chart(b, bad);'
		].join('\n')
	});
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', join(root, 'src/chart.ts'), '--json']);
	assert.equal(code, 1);
	const { entries } = JSON.parse(out);
	assert.deepEqual(
		entries.map((entry) => [
			entry.name,
			entry.pattern,
			entry.line,
			entry.result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.path)
		]),
		[
			['inline config', 'chartjs.new-chart', 3, ['$.options.responsive']],
			['bad', 'chartjs.new-chart', 5, ['$.data']]
		]
	);
	// --name still selects a variable, whatever the uses.
	const named = JSON.parse(
		(
			await run([
				'analyze',
				'--library',
				'chartjs',
				'--file',
				join(root, 'src/chart.ts'),
				'--name',
				'options',
				'--json'
			])
		).out
	);
	assert.deepEqual(
		named.entries.map((entry) => entry.name),
		['options']
	);
});

test("--patterns adds the project's own wrappers; a malformed patterns file is an input error", async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		'chartguard.patterns.json': JSON.stringify([
			{ id: 'local.render', library: 'echarts', file: 'src/render.ts', export: 'render', argument: 1 }
		]),
		'bad.patterns.json': JSON.stringify([{ id: 'x', library: 'd3', module: 'm', export: 'f', argument: 0 }]),
		'list.json': '{}',
		'src/render.ts': 'export function render(el: unknown, option: unknown) { return [el, option]; }',
		'src/chart.ts': 'import { render } from "./render";\nrender(el, { series: 5 });'
	});
	const file = join(root, 'src/chart.ts');
	const found = await run([
		'analyze',
		'--library',
		'echarts',
		'--file',
		file,
		'--patterns',
		join(root, 'chartguard.patterns.json'),
		'--json'
	]);
	assert.equal(found.code, 1);
	assert.deepEqual(
		JSON.parse(found.out).entries.map((entry) => [entry.pattern, entry.complete]),
		[['local.render', true]]
	);
	for (const patterns of ['bad.patterns.json', 'list.json', 'missing.json']) {
		const refused = await run(['analyze', '--library', 'echarts', '--file', file, '--patterns', join(root, patterns)]);
		assert.equal(refused.code, 2, patterns);
	}
	assert.equal((await run(['validate', '--library', 'echarts', '--file', 'x.json', '--patterns', 'p.json'])).code, 2);
});
