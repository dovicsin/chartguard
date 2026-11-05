import assert from 'node:assert/strict';
import test from 'node:test';

import plugin from '../dist/index.js';
import { at, finding, javascript, typescript } from './helpers.mjs';

/** Findings in source, at the range of the value they are about (CG-06-03 part 1). */
const { 'valid-config': validConfig, 'config-warnings': configWarnings } = plugin.rules;
const CHART = "import { Chart } from 'chart.js';\n";
const TYPE = 'CFG_TYPE $.options.scales.y.min: Expected number | function, got string.';
const UNKNOWN =
	'CFG_UNKNOWN_KEY $.options.scales.y.beginAtZerro: Unknown property "beginAtZerro" for this partial schema. Did you mean "beginAtZero"?';

test('valid-config: nothing to claim when nothing is handed to a chart library or the config is right', () => {
	javascript.run('valid-config', validConfig, {
		valid: [
			// Named like a config, never handed to a chart: not a lint claim.
			"const config = { type: 'bar', options: { scales: { y: { min: 'x' } } } };",
			// A callee that does not come from the library.
			"new Chart(ctx, { type: 'bar', options: { scales: { y: { min: 'x' } } } });",
			`${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [{ data: [1] }] } });`,
			// Imported or computed values are unknown: validated as incomplete input, never a confirmed error.
			`${CHART}import { options } from './options.js';\nnew Chart(ctx, { type: 'bar', data, options });`,
			`${CHART}new Chart(ctx, { ...base, options: { scales: { y: { min: limit() } } } });`,
			// A reassignable binding may not hold its initializer when the chart is built.
			`${CHART}let config = { type: 'bar', options: { scales: { y: { min: 'x' } } } };\nconfig = other;\nnew Chart(ctx, config);`,
			// Warnings are the other rule's.
			`${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { beginAtZerro: true } } } });`
		],
		invalid: [
			{
				code: `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`,
				errors: [
					finding(
						TYPE,
						at(
							`${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`,
							"'x'"
						)
					)
				]
			}
		]
	});
});

test('a finding stands where its value was written, through a const, with line breaks counted as ESLint counts them', () => {
	const viaConst = `${CHART}const y = { min: 'x' };\nconst config = { type: 'bar', data: { datasets: [] }, options: { scales: { y } } };\nnew Chart(ctx, config);`;
	const crlf = `${CHART}const config = {\r\n  type: 'bar',\r\n  data: { datasets: [] },\r\n  options: { scales: { y: { min: 'x' } } }\r\n};\r\nnew Chart(ctx, config);`;
	const separators = `${CHART}/* a\u2028b\u2029c */ new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const bom = `\uFEFF${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	javascript.run('valid-config', validConfig, {
		valid: [],
		invalid: [viaConst, crlf, separators]
			.map((code) => ({ code, errors: [finding(TYPE, at(code, "'x'"))] }))
			.concat({
				code: bom,
				// ESLint strips the byte order mark before rules see the text.
				errors: [finding(TYPE, at(bom.slice(1), "'x'"))]
			})
	});
});

test('one config handed to two charts is reported once', () => {
	const code = `${CHART}const config = { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } };\nnew Chart(a, config);\nnew Chart(b, config);`;
	javascript.run('valid-config', validConfig, {
		valid: [],
		invalid: [{ code, errors: [finding(TYPE, at(code, "'x'"))] }]
	});
});

test('config-warnings: the warnings, with their suggestion; errors are the other rule', () => {
	const code = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { beginAtZerro: true, min: 'x' } } } });`;
	javascript.run('config-warnings', configWarnings, {
		valid: [`${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] } });`],
		invalid: [{ code, errors: [finding(UNKNOWN, at(code, 'true'))] }]
	});
});

test('ECharts and Highcharts uses, each checked with its own library', () => {
	const echarts = `import * as echarts from 'echarts';\necharts.init(el).setOption({ xAxis: { type: 'catgory' }, yAxis: {}, series: [{ type: 'bar', data: [1] }] });`;
	const highcharts = `import Highcharts from 'highcharts';\nHighcharts.chart('container', { credits: { enabled: 'no' }, series: [] });`;
	javascript.run('valid-config', validConfig, {
		valid: [
			`import * as echarts from 'echarts';\necharts.init(el).setOption({ series: [{ type: 'bar', data: [1] }], xAxis: {}, yAxis: {} });`
		],
		invalid: [
			{
				code: echarts,
				errors: [
					finding('CFG_ENUM $.xAxis.type: Value must be one of: value, log, category, time.', at(echarts, "'catgory'"))
				]
			},
			{
				code: highcharts,
				errors: [finding('CFG_TYPE $.credits.enabled: Expected boolean, got string.', at(highcharts, "'no'"))]
			}
		]
	});
});

test('TSX through typescript-eslint: a react-chartjs-2 element is a use', () => {
	const code =
		"import { Bar } from 'react-chartjs-2';\nexport const view = <Bar data={{ datasets: [] }} options={{ scales: { y: { min: 'x' } } }} />;";
	typescript.run('valid-config', validConfig, {
		valid: [
			{
				code: "import { Bar } from 'react-chartjs-2';\nexport const view = <Bar data={{ datasets: [] }} />;",
				filename: 'view.tsx'
			}
		],
		invalid: [{ code, filename: 'view.tsx', errors: [finding(TYPE, at(code, "'x'"))] }]
	});
});

test("each rule's documentation is the reference page of its findings: the codes, or the quality rules (CG-06-07)", () => {
	const reference = 'https://dovicsin.github.io/chartguard/reference/';
	assert.deepEqual(
		Object.entries(plugin.rules).map(([name, rule]) => [name, rule.meta.docs.url]),
		[
			['valid-config', `${reference}codes.html`],
			['config-warnings', `${reference}codes.html`],
			['chart-quality', `${reference}rules.html`]
		]
	);
});
