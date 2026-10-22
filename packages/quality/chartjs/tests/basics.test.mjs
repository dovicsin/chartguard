import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPackagePointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

/** The label, access and contrast rules (CG-05-04 parts 3, 5, 6) fire on most bare test configs; they have tests of their own. */
const LABELS = new Set([
	'VIS_PLACEHOLDER_TEXT',
	'VIS_VALUE_AXIS_UNTITLED',
	'VIS_DATA_NOT_DESCRIBED',
	'VIS_LOW_CONTRAST_SERIES'
]);
const codes = (config) =>
	analyze(config)
		.diagnostics.filter((d) => !LABELS.has(d.code))
		.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;

test('an empty config is an advisory report with no findings', () => {
	const report = analyze({});
	assert.equal(report.library, 'chartjs');
	assert.deepEqual(report.diagnostics, []);
	assert.deepEqual(normalize({}).series, { known: true, path: '$.data.datasets', items: [] });
});

test('datasets: type inherited from the chart, kind, name, coordinate system and the scale their values are measured on', () => {
	const { series } = normalize({
		type: 'bar',
		data: {
			datasets: [
				{ label: 'Sales', data: [1] },
				{ type: 'line', yAxisID: 'y-right', data: [2] },
				{ type: 'doughnut' },
				{ type: 'radar' },
				{ type: 'sankey' }
			]
		}
	});
	assert.deepEqual(
		series.items.map(({ type, kind, name, coordinateSystem, valueAxis }) => [
			brief(type),
			brief(kind),
			brief(name),
			brief(coordinateSystem),
			brief(valueAxis)
		]),
		[
			[
				'bar config $.type',
				'bar config $.type',
				'Sales config $.data.datasets[0].label',
				'cartesian config $.type',
				'y default $.data.datasets[0].yAxisID'
			],
			[
				'line config $.data.datasets[1].type',
				'line config $.data.datasets[1].type',
				'? unset $.data.datasets[1].label',
				'cartesian config $.data.datasets[1].type',
				'y-right config $.data.datasets[1].yAxisID'
			],
			[
				'doughnut config $.data.datasets[2].type',
				'pie config $.data.datasets[2].type',
				'? unset $.data.datasets[2].label',
				'? inapplicable $.data.datasets[2]',
				'? inapplicable $.data.datasets[2].yAxisID'
			],
			[
				'radar config $.data.datasets[3].type',
				'other config $.data.datasets[3].type',
				'? unset $.data.datasets[3].label',
				'polar config $.data.datasets[3].type',
				'r default $.data.datasets[3].rAxisID'
			],
			[
				'sankey config $.data.datasets[4].type',
				'other config $.data.datasets[4].type',
				'? unset $.data.datasets[4].label',
				'? unmodelled $.data.datasets[4]',
				'? unmodelled $.data.datasets[4].yAxisID'
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
		axes.map(({ key, path, min, max, title }) => [key, path, brief(min), brief(max), brief(title.text)]),
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
				' default $.options.scales.y.title.text'
			],
			[
				'y-right',
				'$.options.scales["y-right"]',
				'? unset $.options.scales["y-right"].min',
				'? unset $.options.scales["y-right"].max',
				' default $.options.scales["y-right"].title.text'
			]
		]
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
	assert.deepEqual(codes({ type: 'bar', options: { scales: { y: { min: 10 } } } }), []);
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
	assert.equal(brief(chart.series.items[0].stacking), '? accessor $.data.datasets[0].stack');
	assert.equal(reads, 0);
});

test('every runtime default points at the line of the pinned chart.js that applies it', () =>
	assert.equal(checkPackagePointers(import.meta.url), 25));

test('access: a canvas gets its text alternative and keyboard access from the page', () => {
	const { dataDescribed, keyboard } = normalize({}).access;
	assert.deepEqual([brief(dataDescribed), brief(keyboard)], ['? unmodelled $', '? unmodelled $']);
});
