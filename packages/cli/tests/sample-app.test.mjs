import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run } from './helpers.mjs';

/** The M3 gate: a real mixed JavaScript/TypeScript app, read without running it (examples/sample-app). */
const APP = fileURLToPath(new URL('../../../examples/sample-app/', import.meta.url));
const TSCONFIG = join(APP, 'tsconfig.json');
const scan = async (library) => {
	const { code, out } = await run(['analyze', '--library', library, '--project', TSCONFIG, '--json']);
	return { code, report: JSON.parse(out) };
};
const relative = (file) => file.slice(APP.length).replaceAll('\\', '/');
const errors = (entry) =>
	entry.result.diagnostics
		.filter((d) => d.severity === 'error')
		.map((d) => `${d.code} ${d.path} ${relative(d.file)}:${String(d.line)}`);

test('sample app, Chart.js: a builder through new Chart and a react-chartjs-2 component, read across files', async () => {
	const { code, report } = await scan('chartjs');
	assert.equal(code, 1);
	assert.deepEqual(report.project.tsconfig, TSCONFIG);
	assert.deepEqual(
		report.entries.map((entry) => [relative(entry.file), entry.pattern, entry.complete]),
		[
			['src/charts/sales.ts', 'chartjs.new-chart', false],
			['src/components/Revenue.tsx', 'chartjs.react-chartjs-2', false]
		]
	);
	assert.deepEqual(errors(report.entries[1]), ['CFG_ENUM $.options.animation src/components/Revenue.tsx:7']);
});

test('sample app, ECharts: a JavaScript module whose instance comes from echarts.init', async () => {
	const { code, report } = await scan('echarts');
	assert.equal(code, 1);
	assert.deepEqual(
		report.entries.map((entry) => [relative(entry.file), entry.name, entry.complete]),
		[['src/charts/traffic.js', 'option', true]]
	);
	assert.deepEqual(errors(report.entries[0]), ['CFG_TYPE $.xAxis.boundaryGap src/charts/traffic.js:4']);
});

test('sample app, Highcharts: a highcharts-react component', async () => {
	const { report } = await scan('highcharts');
	assert.deepEqual(
		report.entries.map((entry) => [relative(entry.file), entry.pattern, entry.complete]),
		[['src/components/Stock.tsx', 'highcharts.highcharts-react', true]]
	);
});

test('sample app: what cannot be read is explicit, with its reason and where the write is', async () => {
	const { analyzeProjectFiles } = await import('@chartguard/analysis-typescript/project');
	const { files } = await analyzeProjectFiles(TSCONFIG);
	const unknown = files.flatMap((file) =>
		file.uses.flatMap((use) =>
			use.paths
				.filter((fact) => !fact.known)
				.map((fact) => `${relative(file.fileName)} ${fact.path} ${fact.reason} ${relative(fact.file)}`)
		)
	);
	assert.deepEqual(unknown.sort(), [
		'src/charts/sales.ts $.data.datasets[0].backgroundColor name src/charts/sales.ts',
		'src/charts/sales.ts $.options spread src/charts/sales.ts',
		'src/charts/sales.ts $.options.plugins.legend.display mutated src/dark.ts',
		'src/components/Revenue.tsx $.data.datasets[0].data name src/components/Revenue.tsx',
		'src/components/Revenue.tsx $.options spread src/components/Revenue.tsx',
		'src/components/Revenue.tsx $.options.plugins.legend.display mutated src/dark.ts'
	]);
});
