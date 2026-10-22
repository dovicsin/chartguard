/** Layout facts: orientation, scale binding, scale types, areas, stacking (CG-05-03, CG-05-04). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const codes = (config) => analyze(config).diagnostics.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const first = (config) => normalize(config).series.items[0];
const bars = (extra = {}, options = {}) => ({ type: 'bar', data: { datasets: [{ data: [1], ...extra }] }, options });

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

test('scales: type from the config, else from the chart type by role or axis; reverse defaults to false', () => {
	const axis = (config, key) => normalize(config).axes.find((candidate) => candidate.key === key);
	const scale = (config, key) => brief(axis(config, key).scale);
	assert.equal(scale(bars(), 'y'), 'linear default $.options.scales.y.type');
	assert.equal(scale(bars({}, { scales: { x: {} } }), 'x'), 'category default $.options.scales.x.type');
	// Horizontal bars: the index scale is y, so y is the category one.
	assert.equal(scale(bars({}, { indexAxis: 'y', scales: { y: {} } }), 'y'), 'category default $.options.scales.y.type');
	assert.equal(scale(bars({}, { scales: { y: { type: 'logarithmic' } } }), 'y'), 'log config $.options.scales.y.type');
	assert.equal(
		scale({ type: 'scatter', data: { datasets: [{ data: [] }] } }, 'x'),
		'linear default $.options.scales.x.type'
	);
	assert.equal(
		scale({ type: 'radar', data: { datasets: [{ data: [] }] } }, 'r'),
		'linear default $.options.scales.r.type'
	);
	assert.equal(
		scale(
			{ type: 'line', data: { datasets: [{ data: [] }] }, options: { scales: { y: { type: 'timeseries' } } } },
			'y'
		),
		'time config $.options.scales.y.type'
	);
	assert.equal(
		scale({ type: 'sankey', data: { datasets: [] }, options: { scales: { y: {} } } }, 'y'),
		'? unset $.options.scales.y.type'
	);
	assert.equal(brief(axis(bars(), 'y').reversed), 'false default $.options.scales.y.reverse');
	assert.equal(
		brief(axis(bars({}, { scales: { y: { reverse: true } } }), 'y').reversed),
		'true config $.options.scales.y.reverse'
	);
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
