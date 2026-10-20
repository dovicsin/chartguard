import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs, PatternError } from '../dist/index.js';

const json = (value) => JSON.parse(JSON.stringify(value ?? null));
const uses = (source, filename = 'chart.ts', options) =>
	extractStaticConfigs(source, filename, options).uses.map((use) => ({
		library: use.library,
		pattern: use.pattern,
		line: use.line,
		complete: use.complete,
		value: json(use.value),
		...(use.source === undefined ? {} : { source: use.source })
	}));
const CONFIG = 'const config = { type: "bar", data: { datasets: [] } };\n';

test('Chart.js: new Chart from chart.js, chart.js/auto, a namespace or require; an inline config too', () => {
	const cases = [
		'import { Chart } from "chart.js";',
		'import Chart from "chart.js/auto";',
		'import { Chart as C } from "chart.js";\nconst Chart = C;',
		'const { Chart } = require("chart.js");'
	];
	for (const header of cases)
		assert.deepEqual(
			uses(`${header}\n${CONFIG}new Chart(ctx, config);`).map(({ pattern, source, complete }) => [
				pattern,
				source,
				complete
			]),
			[['chartjs.new-chart', 'config', true]],
			header
		);
	assert.deepEqual(uses('import * as C from "chart.js";\nnew C.Chart(ctx, { type: "line" });'), [
		{ library: 'chartjs', pattern: 'chartjs.new-chart', line: 2, complete: true, value: { type: 'line' } }
	]);
});

test('a callee that does not come from the library is not a use', () => {
	assert.deepEqual(uses(`${CONFIG}new Chart(ctx, config);`), []);
	assert.deepEqual(uses(`class Chart {}\n${CONFIG}new Chart(ctx, config);`), []);
	assert.deepEqual(uses(`import { Chart } from "./my-chart";\n${CONFIG}new Chart(ctx, config);`), []);
	assert.deepEqual(uses(`import { Chart } from "chart.js";\n${CONFIG}Chart(ctx, config);`), []);
	// A let alias may hold something else by the time it is called.
	assert.deepEqual(
		uses(`import { Chart as C } from "chart.js";\nlet Chart = C;\nChart = Other;\n${CONFIG}new Chart(ctx, config);`),
		[]
	);
});

test('ECharts: setOption on echarts.init, directly or through a const; a let instance is not followed', () => {
	const header = 'import * as echarts from "echarts";\nconst option = { series: [] };\n';
	const pattern = (source) => uses(source).map(({ pattern: id, source: name }) => [id, name]);
	assert.deepEqual(pattern(`${header}const chart = echarts.init(el);\nchart.setOption(option);`), [
		['echarts.set-option', 'option']
	]);
	assert.deepEqual(pattern(`${header}echarts.init(el).setOption(option, true);`), [['echarts.set-option', 'option']]);
	assert.deepEqual(pattern('import { init } from "echarts/core";\nconst c = init(el);\nc.setOption({ series: [] });'), [
		['echarts.set-option', undefined]
	]);
	assert.deepEqual(pattern(`${header}let chart = echarts.init(el);\nchart.setOption(option);`), []);
	assert.deepEqual(pattern(`${header}const chart = other.init(el);\nchart.setOption(option);`), []);
});

test('Highcharts: the options argument, whether a container or a callback comes with it', () => {
	const header = 'import Highcharts from "highcharts";\nconst options = { series: [] };\n';
	const sources = (source) => uses(source).map(({ pattern, source: name }) => [pattern, name]);
	assert.deepEqual(sources(`${header}Highcharts.chart("container", options);`), [['highcharts.chart', 'options']]);
	assert.deepEqual(sources(`${header}Highcharts.chart(options, () => {});`), [['highcharts.chart', 'options']]);
	assert.deepEqual(sources(`${header}Highcharts.chart(options);`), [['highcharts.chart', 'options']]);
	assert.deepEqual(sources(`${header}Highcharts.stockChart(el, options, function () {});`), [
		['highcharts.chart', 'options']
	]);
	assert.deepEqual(sources(`${header}new Highcharts.Chart(el, options);`), [['highcharts.chart', 'options']]);
	assert.deepEqual(
		sources('import { mapChart } from "highcharts/highmaps";\nconst options = {};\nmapChart(el, options);'),
		[['highcharts.chart', 'options']]
	);
});

test('React wrappers: react-chartjs-2 builds the config from its props; echarts-for-react and highcharts-react pass one', () => {
	const tsx = (source) => uses(source, 'chart.tsx');
	assert.deepEqual(
		tsx(
			'import { Bar } from "react-chartjs-2";\nconst data = { datasets: [] };\nconst view = <Bar data={data} options={{ responsive: true }} />;'
		).map(({ pattern, value, complete }) => [pattern, value, complete]),
		[['chartjs.react-chartjs-2', { type: 'bar', data: { datasets: [] }, options: { responsive: true } }, true]]
	);
	assert.deepEqual(
		tsx(
			'import { Chart } from "react-chartjs-2";\nconst view = <Chart type="line" data={{ datasets: [] }} plugins={[]} />;'
		)[0].value,
		{ type: 'line', data: { datasets: [] }, plugins: [] }
	);
	// A spread attribute may supply any earlier prop.
	assert.deepEqual(
		tsx(
			'import { Line } from "react-chartjs-2";\nconst view = <Line options={{ a: 1 }} {...props} data={{ datasets: [] }} />;'
		).map(({ value, complete }) => [value, complete]),
		[[{ type: 'line', data: { datasets: [] } }, false]]
	);
	assert.deepEqual(
		tsx(
			'import ReactECharts from "echarts-for-react";\nconst option = { series: [] };\nconst v = <ReactECharts option={option} notMerge />;'
		).map(({ pattern, source }) => [pattern, source]),
		[['echarts.echarts-for-react', 'option']]
	);
	assert.deepEqual(
		tsx(
			'import HighchartsReact from "highcharts-react-official";\nconst options = {};\nconst v = <HighchartsReact highcharts={H} options={options} />;'
		).map(({ pattern, source }) => [pattern, source]),
		[['highcharts.highcharts-react', 'options']]
	);
});

test('ChartGuard runtime wrappers are uses of their library', () => {
	assert.deepEqual(
		uses(
			`import { validateBeforeCreate } from "@chartguard/runtime-echarts";\nconst option = {};\nvalidateBeforeCreate(option, (o) => o);`
		).map(({ library, pattern }) => [library, pattern]),
		[['echarts', 'echarts.validate-before-create']]
	);
});

test('a use carries why its value is incomplete: unresolved parts and writes of the passed binding', () => {
	const [use] = extractStaticConfigs(
		`import { Chart } from "chart.js";\n${CONFIG}config.data.datasets.push(x);\nnew Chart(ctx, config);\nnew Chart(ctx, { type: make() });`,
		'chart.ts'
	).uses;
	assert.deepEqual(
		[use.complete, use.diagnostics.map((d) => [d.code, d.path, d.line])],
		[false, [['CFG_MUTATED', '$.data.datasets', 3]]]
	);
	const inline = extractStaticConfigs(
		`import { Chart } from "chart.js";\nnew Chart(ctx, { type: make() });`,
		'chart.ts'
	).uses[0];
	assert.deepEqual(
		inline.diagnostics.map((d) => d.code),
		['CFG_DYNAMIC']
	);
});

test("configurable patterns add a project's own wrappers by package or JSX prop", () => {
	const patterns = [
		{ id: 'acme.render', library: 'echarts', module: '@acme/charts', export: 'render', argument: 1 },
		{ id: 'acme.view', library: 'highcharts', module: '@acme/charts', export: 'default.View', prop: 'config' },
		{ id: 'acme.make', library: 'chartjs', module: '@acme/charts', export: 'Maker', argument: 0, construct: true }
	];
	const source = [
		'import Acme, { render, Maker } from "@acme/charts";',
		'const option = { series: [] };',
		'render(el, option);',
		'new Maker({ type: "bar" });',
		'Maker({ type: "pie" });',
		'const v = <Acme.View config={{ title: {} }} />;'
	].join('\n');
	assert.deepEqual(
		uses(source, 'chart.tsx', { patterns }).map(({ pattern, value }) => [pattern, value]),
		[
			['acme.render', { series: [] }],
			['acme.make', { type: 'bar' }],
			['acme.view', { title: {} }]
		]
	);
});

test('malformed patterns are refused with every problem', () => {
	const refused = (patterns) => {
		try {
			extractStaticConfigs('', 'chart.ts', { patterns });
		} catch (error) {
			assert.ok(error instanceof PatternError);
			return error.problems;
		}
		return assert.fail('expected a PatternError');
	};
	assert.deepEqual(
		refused([
			{ id: 'a', library: 'd3', module: 'x', export: 'f', argument: 0 },
			{ id: 'b', library: 'chartjs', export: 'f', argument: 0 },
			{ id: 'c', library: 'chartjs', module: 'x', export: 'f', argument: 0, prop: 'p' },
			{ id: 'd', library: 'chartjs', module: 'x', export: '', argument: -1 },
			{ library: 'chartjs', module: 'x', export: 'f', argument: 0 }
		]),
		[
			'a: library must be chartjs, echarts or highcharts',
			'b: exactly one of module and file',
			'c: exactly one of argument and prop',
			'd: export must be a non-empty dotted path',
			'd: argument must be a non-negative integer',
			'pattern 5: id must be a non-empty string'
		]
	);
});

test('a use in a file with syntax errors, or whose prop may come from a spread, is incomplete and says why', () => {
	const [broken] = extractStaticConfigs(
		'import { Chart } from "chart.js";\nnew Chart(ctx, { type: "bar" b: 1 });',
		'chart.ts'
	).uses;
	assert.deepEqual([broken.complete, broken.diagnostics.map((d) => d.code)], [false, ['CFG_SYNTAX']]);
	const [spread] = extractStaticConfigs(
		'import ReactECharts from "echarts-for-react";\nconst v = <ReactECharts {...props} />;',
		'chart.tsx'
	).uses;
	assert.deepEqual(
		[spread.complete, spread.value, spread.diagnostics.map((d) => d.code)],
		[false, undefined, ['CFG_DYNAMIC']]
	);
	const [missing] = extractStaticConfigs(
		'import ReactECharts from "echarts-for-react";\nconst v = <ReactECharts />;',
		'chart.tsx'
	).uses;
	assert.deepEqual([missing.complete, missing.value], [true, undefined]);
});
