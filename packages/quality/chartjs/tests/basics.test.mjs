import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

const codes = (config) => analyze(config).diagnostics.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;

test('an empty config is an advisory report with no findings', () => {
	const report = analyze({});
	assert.equal(report.library, 'chartjs');
	assert.deepEqual(report.diagnostics, []);
	assert.deepEqual(normalize({}).series, { known: true, path: '$.data.datasets', items: [] });
});

test('datasets: type inherited from the chart, kind, name, and the scale their values are measured on', () => {
	const { series } = normalize({
		type: 'bar',
		data: {
			datasets: [
				{ label: 'Sales', data: [1] },
				{ type: 'line', yAxisID: 'y-right', data: [2] },
				{ type: 'doughnut' },
				{ type: 'radar' }
			]
		}
	});
	assert.deepEqual(
		series.items.map(({ path, type, kind, name, valueAxis }) => [
			path,
			brief(type),
			brief(kind),
			brief(name),
			brief(valueAxis)
		]),
		[
			[
				'$.data.datasets[0]',
				'bar config $.type',
				'bar config $.type',
				'Sales config $.data.datasets[0].label',
				'y default $.data.datasets[0].yAxisID'
			],
			[
				'$.data.datasets[1]',
				'line config $.data.datasets[1].type',
				'line config $.data.datasets[1].type',
				'? unset $.data.datasets[1].label',
				'y-right config $.data.datasets[1].yAxisID'
			],
			[
				'$.data.datasets[2]',
				'doughnut config $.data.datasets[2].type',
				'pie config $.data.datasets[2].type',
				'? unset $.data.datasets[2].label',
				'? inapplicable $.data.datasets[2].yAxisID'
			],
			[
				'$.data.datasets[3]',
				'radar config $.data.datasets[3].type',
				'other config $.data.datasets[3].type',
				'? unset $.data.datasets[3].label',
				'? unmodelled $.data.datasets[3].yAxisID'
			]
		]
	);
});

test('axes: every configured scale and every scale a dataset uses, with quoted keys where needed', () => {
	const { axes } = normalize({
		type: 'line',
		data: { datasets: [{ yAxisID: 'y-right' }] },
		options: { scales: { x: { title: { text: ['Month', '2026'] } }, y: { min: 10, max: 'a' } } }
	});
	assert.deepEqual(
		axes.map(({ key, path, min, max, title }) => [key, path, brief(min), brief(max), brief(title)]),
		[
			[
				'x',
				'$.options.scales.x',
				'? unset $.options.scales.x.min',
				'? unset $.options.scales.x.max',
				'Month 2026 config $.options.scales.x.title.text'
			],
			[
				'y',
				'$.options.scales.y',
				'10 config $.options.scales.y.min',
				'? shape $.options.scales.y.max',
				'? unset $.options.scales.y.title.text'
			],
			[
				'y-right',
				'$.options.scales["y-right"]',
				'? unset $.options.scales["y-right"].min',
				'? unset $.options.scales["y-right"].max',
				'? unset $.options.scales["y-right"].title.text'
			]
		]
	);
});

test('a horizontal layout (indexAxis other than x, anywhere Chart.js reads it) leaves the value axis unmodelled', () => {
	const bar = (extra, options = {}) =>
		normalize({ type: 'bar', data: { datasets: [{ data: [1], ...extra }] }, options }).series.items[0].valueAxis;
	assert.equal(brief(bar({ indexAxis: 'y' })), '? unmodelled $.data.datasets[0].yAxisID');
	assert.equal(brief(bar({}, { indexAxis: 'y' })), '? unmodelled $.data.datasets[0].yAxisID');
	assert.equal(brief(bar({}, { datasets: { bar: { indexAxis: 'y' } } })), '? unmodelled $.data.datasets[0].yAxisID');
	assert.equal(brief(bar({}, { indexAxis: 'x' })), 'y default $.data.datasets[0].yAxisID');
	assert.equal(brief(bar({ indexAxis: () => 'y' })), '? dynamic $.data.datasets[0].yAxisID');
	assert.deepEqual(
		codes({ type: 'bar', data: { datasets: [{ data: [1] }] }, options: { indexAxis: 'y', scales: { y: { min: 5 } } } }),
		[]
	);
});

test('the title is shown only when displayed (Chart.js default: hidden)', () => {
	const { title } = normalize({ options: { plugins: { title: { text: 'Sales' } } } });
	assert.equal(brief(title.text), 'Sales config $.options.plugins.title.text');
	assert.equal(brief(title.shown), 'false default $.options.plugins.title.display');
	assert.deepEqual(codes({ options: { plugins: { title: { text: ' ' } } } }), []);
	assert.deepEqual(codes({ options: { plugins: { title: { text: ' ', display: true } } } }), [
		'VIS_EMPTY_TITLE $.options.plugins.title.text'
	]);
});

test('findings point at the Chart.js option that triggered them', () => {
	const config = {
		type: 'bar',
		data: { datasets: [{ data: [1] }] },
		options: { scales: { y: { min: 10 } }, plugins: { title: { text: ' ', display: true } } }
	};
	assert.deepEqual(codes(config), [
		'VIS_BAR_BASELINE $.options.scales.y.min',
		'VIS_EMPTY_TITLE $.options.plugins.title.text'
	]);
	// No bar dataset is drawn: nothing to claim about a bar baseline.
	assert.deepEqual(codes({ type: 'bar', options: { scales: { y: { min: 10 } } } }), []);
	// A line on the same scale as a bar does not change it; a line alone does not trigger it.
	assert.deepEqual(
		codes({ type: 'line', data: { datasets: [{ data: [1] }] }, options: { scales: { y: { min: 10 } } } }),
		[]
	);
});

test('getters are never run and leave their facts unknown', () => {
	let reads = 0;
	const datasets = [
		Object.defineProperty({ data: [1] }, 'yAxisID', { enumerable: true, get: () => ((reads += 1), 'y') })
	];
	const chart = normalize({
		type: 'bar',
		data: { datasets },
		options: Object.defineProperty({}, 'scales', { get: () => ((reads += 1), {}) })
	});
	assert.equal(brief(chart.series.items[0].valueAxis), '? accessor $.data.datasets[0].yAxisID');
	assert.equal(reads, 0);
});

test('every runtime default points at the line of the pinned chart.js that applies it', () =>
	assert.equal(checkPointers(fileURLToPath(new URL('../src/index.ts', import.meta.url))), 3));
