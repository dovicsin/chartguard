import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPackagePointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

const codes = (config) => analyze(config).diagnostics.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const first = (config) => normalize(config).series.items[0];
const bars = (extra = {}, options = {}) => ({ type: 'bar', data: { datasets: [{ data: [1], ...extra }] }, options });

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

test('orientation: the index axis from the dataset, the options for its type or the chart, else x; values on the other axis', () => {
	const layout = (config) => {
		const { orientation, valueAxis } = first(config);
		return [brief(orientation), brief(valueAxis)];
	};
	assert.deepEqual(layout(bars()), [
		'vertical default $.data.datasets[0].indexAxis',
		'y default $.data.datasets[0].yAxisID'
	]);
	assert.deepEqual(layout(bars({ indexAxis: 'y', xAxisID: 'amount' })), [
		'horizontal config $.data.datasets[0].indexAxis',
		'amount config $.data.datasets[0].xAxisID'
	]);
	assert.deepEqual(layout(bars({}, { datasets: { bar: { indexAxis: 'y' } } })), [
		'horizontal config $.options.datasets.bar.indexAxis',
		'x default $.data.datasets[0].xAxisID'
	]);
	assert.deepEqual(layout(bars({}, { indexAxis: 'y' })), [
		'horizontal config $.options.indexAxis',
		'x default $.data.datasets[0].xAxisID'
	]);
	// The dataset's own index axis wins over the chart's.
	assert.deepEqual(layout(bars({ indexAxis: 'x' }, { indexAxis: 'y' })), [
		'vertical config $.data.datasets[0].indexAxis',
		'y default $.data.datasets[0].yAxisID'
	]);
	assert.deepEqual(layout(bars({ indexAxis: () => 'y' })), [
		'? dynamic $.data.datasets[0].indexAxis',
		'? dynamic $.data.datasets[0].yAxisID'
	]);
	assert.deepEqual(layout(bars({ indexAxis: 'r' })), [
		'? unmodelled $.data.datasets[0].indexAxis',
		'? unmodelled $.data.datasets[0].yAxisID'
	]);
});

test('a dataset without a scale id is on the first scale of its axis, in the order Chart.js builds them', () => {
	const valueAxis = (scales, extra = {}) => brief(first({ ...bars(extra, { scales }) }).valueAxis);
	// A configured scale comes before the one the dataset's type adds: here it is y1, not y.
	assert.equal(valueAxis({ y1: { position: 'right' } }), 'y1 default $.data.datasets[0].yAxisID');
	// The axis of a configured scale: its id, `axis`, `position`, the first letter of its id, a dataset binding it.
	assert.equal(valueAxis({ amount: { axis: 'y' } }), 'amount default $.data.datasets[0].yAxisID');
	assert.equal(valueAxis({ top: { position: 'top' }, yLeft: {} }), 'yLeft default $.data.datasets[0].yAxisID');
	assert.equal(valueAxis({ x: {}, y: {} }), 'y default $.data.datasets[0].yAxisID');
	const bound = {
		type: 'bar',
		data: { datasets: [{ data: [1] }, { data: [2], yAxisID: 'money' }] },
		options: { scales: { money: {} } }
	};
	assert.equal(brief(normalize(bound).series.items[0].valueAxis), 'money default $.data.datasets[0].yAxisID');
	// A scale before it whose axis cannot be read, or scales that cannot be read, leave the binding unknown.
	assert.equal(
		valueAxis({ hidden: Object.defineProperty({}, 'position', { get: () => 'left' }) }),
		'? unmodelled $.data.datasets[0].yAxisID'
	);
	assert.equal(
		brief(
			first({
				type: 'bar',
				data: { datasets: [{ data: [1] }] },
				options: Object.defineProperty({}, 'scales', { get: () => ({}) })
			}).valueAxis
		),
		'? unmodelled $.data.datasets[0].yAxisID'
	);
	// Scales Chart.js skips (not plain objects) take no place.
	assert.equal(valueAxis({ y1: 'right' }), 'y default $.data.datasets[0].yAxisID');
	// An earlier dataset's scale counts too.
	const earlier = { type: 'bar', data: { datasets: [{ data: [1], yAxisID: 'first' }, { data: [2] }] } };
	assert.equal(brief(normalize(earlier).series.items[1].valueAxis), 'first default $.data.datasets[1].yAxisID');
});

test('a horizontal bar is measured on its x scale: its baseline is the x minimum, not the y one', () => {
	assert.deepEqual(codes(bars({}, { indexAxis: 'y', scales: { y: { min: 5 } } })), []);
	assert.deepEqual(codes(bars({}, { indexAxis: 'y', scales: { x: { min: 5 } } })), [
		'VIS_BAR_BASELINE $.options.scales.x.min'
	]);
});

test('area: a line dataset whose fill (dataset, options for line datasets, line elements) is not false', () => {
	const kind = (dataset, options = {}) =>
		brief(first({ type: 'line', data: { datasets: [{ data: [1], ...dataset }] }, options }).kind);
	assert.equal(kind({}), 'line config $.type');
	assert.equal(kind({ fill: 'origin' }), 'area config $.data.datasets[0].fill');
	assert.equal(kind({ fill: false }), 'line config $.type');
	assert.equal(kind({}, { datasets: { line: { fill: true } } }), 'area config $.options.datasets.line.fill');
	assert.equal(kind({}, { elements: { line: { fill: 'start' } } }), 'area config $.options.elements.line.fill');
	assert.equal(kind({ fill: false }, { elements: { line: { fill: true } } }), 'line config $.type');
	assert.equal(kind({ fill: () => true }), '? dynamic $.data.datasets[0].fill');
});

test('stacking: the value scale says so, else a dataset stack stacks, else none', () => {
	const stacking = (dataset, scales) => brief(first(bars(dataset, { scales })).stacking);
	assert.equal(stacking({}, {}), 'none default $.data.datasets[0].stack');
	assert.equal(stacking({}, { y: { stacked: true } }), 'stacked config $.options.scales.y.stacked');
	assert.equal(stacking({}, { y: { stacked: 'single' } }), 'stacked config $.options.scales.y.stacked');
	assert.equal(stacking({ stack: 'a' }, { y: { stacked: false } }), 'none config $.options.scales.y.stacked');
	assert.equal(stacking({ stack: 'a' }, {}), 'stacked config $.data.datasets[0].stack');
	// The stacked option is read on the value scale: x for horizontal bars.
	assert.equal(
		brief(first(bars({ indexAxis: 'y' }, { scales: { x: { stacked: true } } })).stacking),
		'stacked config $.options.scales.x.stacked'
	);
	assert.equal(
		brief(first({ type: 'pie', data: { datasets: [{ data: [1] }] } }).stacking),
		'? inapplicable $.data.datasets[0].stack'
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
	assert.equal(checkPackagePointers(import.meta.url), 7));
