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
	assert.match(found.out, /error: \S+chart\.ts:1:14 \$\.options\.responsive/);
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

test('each finding carries the exact source range of the value it is about, in the file that wrote it', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		'src/options.ts': 'export const options = {\n\tresponsive: "yes"\n};',
		'src/chart.ts':
			'import { Chart } from "chart.js";\nimport { options } from "./options";\nnew Chart(a, { type: "bar", data: { datasets: [] }, options });'
	});
	const { out } = await run(['analyze', '--library', 'chartjs', '--file', join(root, 'src/chart.ts'), '--json']);
	const [error] = JSON.parse(out).entries[0].result.diagnostics.filter((d) => d.severity === 'error');
	assert.deepEqual(
		[error.path, error.file, error.line, error.column, error.endLine, error.endColumn],
		['$.options.responsive', join(root, 'src/options.ts'), 2, 14, 2, 19]
	);
});

test('several files are read together; without --file, --project reads every file it includes', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{ "include": ["src"] }',
		'src/theme.ts': 'export const theme = { responsive: true };',
		'src/dark.ts': 'import { theme } from "./theme";\ntheme.responsive = "no";',
		'src/chart.ts':
			'import { Chart } from "chart.js";\nimport { theme } from "./theme";\nnew Chart(a, { type: "bar", data: { datasets: [] }, options: theme });',
		'src/broken.ts': 'export const config = { a: 1 b: 2 };'
	});
	const files = ['--file', join(root, 'src/chart.ts'), '--file', join(root, 'src/dark.ts')];
	const together = JSON.parse((await run(['analyze', '--library', 'chartjs', ...files, '--json'])).out);
	assert.deepEqual(
		together.entries.map((entry) => [entry.file, entry.complete]),
		[[join(root, 'src/chart.ts'), false]]
	);
	const scan = await run(['analyze', '--library', 'chartjs', '--project', join(root, 'tsconfig.json')]);
	assert.equal(scan.code, 0);
	assert.match(scan.out, /broken\.ts: not read/);
	assert.match(scan.out, /^inline config \(chartjs\.new-chart\) @ line 3: partial \(dynamic \/ partial\)$/m);
	const json = JSON.parse(
		(await run(['analyze', '--library', 'chartjs', '--project', join(root, 'tsconfig.json'), '--json'])).out
	);
	assert.deepEqual(
		json.unreadable.map((entry) => entry.file),
		[join(root, 'src/broken.ts')]
	);
	// validate and quality read exactly one file; analyze needs a file or a project.
	assert.equal((await run(['validate', '--library', 'chartjs', '--file', 'a.json', '--file', 'b.json'])).code, 2);
	assert.equal((await run(['analyze', '--library', 'chartjs'])).code, 2);
});

test('a config the code changes however it spells the write, or that comes from a replaced builder, is never confirmed invalid (A37, A1)', async (t) => {
	const head =
		'import { Chart } from "chart.js";\nconst config = { type: "bar", data: { datasets: [] }, options: { responsive: "yes" } };\n';
	const use = 'new Chart(document.createElement("canvas"), config as any);';
	const sources = {
		'cast.ts': `${head}(config as any).options.responsive = true;\n${use}`,
		'destructured.ts': `${head}const { options } = config;\n(options as any).responsive = true;\n${use}`,
		'evaluated.ts': `${head}eval("config.options.responsive = true");\n${use}`,
		'replaced.ts':
			'import { Chart } from "chart.js";\nfunction make(): any { return { type: "bar", data: { datasets: [] }, options: { responsive: "yes" } }; }\n// @ts-ignore\nmake = () => ({});\nnew Chart(document.createElement("canvas"), make());'
	};
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		...Object.fromEntries(Object.entries(sources).map(([name, text]) => [`src/${name}`, text]))
	});
	for (const name of Object.keys(sources)) {
		const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', join(root, 'src', name)]);
		assert.equal(code, 0, `${name}: ${out}`);
		assert.doesNotMatch(out, /error:/, name);
	}
	// Spelled plainly the wrong value is still confirmed.
	const plain = sourceProject(t, { 'tsconfig.json': '{}', 'src/plain.ts': `${head}${use}` });
	assert.equal((await run(['analyze', '--library', 'chartjs', '--file', join(plain, 'src/plain.ts')])).code, 1);
});
