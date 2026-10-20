import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeProject } from '../dist/project.js';

const json = (value) => JSON.parse(JSON.stringify(value ?? null));

test('in a project, a library re-exported by a project file and a local wrapper function are recognized', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-uses-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const files = {
		'tsconfig.json': '{}',
		'src/setup.ts': 'export { Chart } from "chart.js";',
		'src/charts.ts': 'export function renderChart(config: unknown) { return config; }'
	};
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	const chart =
		'import { Chart } from "./setup";\nimport { renderChart } from "./charts";\nnew Chart(ctx, { type: "bar" });\nrenderChart({ type: "pie" });';
	const patterns = [
		{ id: 'local.render', library: 'chartjs', file: join(root, 'src/charts.ts'), export: 'renderChart', argument: 0 }
	];
	const analysis = analyzeProject(chart, join(root, 'src/chart.ts'), { patterns });
	assert.deepEqual(
		analysis.uses.map((use) => [use.pattern, json(use.value)]),
		[
			['chartjs.new-chart', { type: 'bar' }],
			['local.render', { type: 'pie' }]
		]
	);
});

test('a package member is named as the code reaches it, also when the package exports it under another name', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-renamed-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const files = {
		'tsconfig.json': '{ "compilerOptions": { "allowJs": true } }',
		'node_modules/echarts/package.json': '{ "name": "echarts", "types": "index.d.ts" }',
		'node_modules/echarts/index.d.ts':
			'declare function init$1(element: unknown): { setOption(option: unknown): void };\nexport { init$1 as init };'
	};
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	const chart =
		'import * as echarts from "echarts";\nconst chart = echarts.init(el);\nchart.setOption({ series: [] });';
	for (const file of ['src/chart.ts', 'src/chart.js'])
		assert.deepEqual(
			analyzeProject(chart, join(root, file)).uses.map((use) => use.pattern),
			['echarts.set-option'],
			file
		);
});
