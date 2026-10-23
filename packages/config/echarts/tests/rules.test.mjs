import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';

/** Only the findings of the cross-option rules (their codes are not used by the schema walk). */
const RULE_CODES = new Set(['CFG_REQUIRES', 'CFG_UNKNOWN_REFERENCE']);
const ruled = (option, options) =>
	validate(option, options)
		.diagnostics.filter((d) => RULE_CODES.has(d.code))
		.map((d) => `${d.severity} ${d.code} ${d.path}`);

const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };
const heatmap = { type: 'heatmap', data: [[0, 0, 1]] };
/** A heatmap on cartesian2d needs two category axes on band (the heatmap-category-axes rule). */
const grid = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'category', data: ['b'] } };

test('heatmap: a series no visualMap targets is rejected by the runtime', () => {
	assert.deepEqual(ruled({ ...grid, series: [heatmap] }), ['error CFG_REQUIRES $.series[0]']);
	assert.deepEqual(ruled({ ...grid, visualMap: { min: 0, max: 1 }, series: [heatmap] }), []);
	assert.deepEqual(ruled({ ...grid, visualMap: [{ seriesIndex: 'all' }], series: heatmap }), []);
	assert.deepEqual(ruled({ ...grid, visualMap: { seriesIndex: [1] }, series: [heatmap, heatmap] }), [
		'error CFG_REQUIRES $.series[0]'
	]);
	assert.deepEqual(
		ruled({ ...grid, visualMap: [{ seriesIndex: 0 }, { seriesIndex: [1] }], series: [heatmap, heatmap] }),
		[]
	);
});

test('heatmap: a visualMap that targets by id or name, or any value read through a getter, makes no claim', () => {
	for (const visualMap of [
		{ seriesId: 'h' },
		{ seriesName: 'h' },
		{ seriesIndex: '0' },
		Object.defineProperty({}, 'seriesIndex', { get: () => 0 })
	])
		assert.deepEqual(ruled({ ...grid, visualMap, series: [heatmap] }), [], JSON.stringify(visualMap));
	assert.deepEqual(
		ruled({ ...grid, series: [Object.defineProperty({ data: [] }, 'type', { get: () => 'heatmap' })] }),
		[]
	);
});

test('heatmap: both axes must be category axes on band, as the runtime resolves their type', () => {
	const visualMap = { min: 0, max: 1 };
	assert.deepEqual(ruled({ ...grid, visualMap, series: [heatmap] }), []);
	assert.deepEqual(ruled({ xAxis: { data: ['a'] }, yAxis: { data: ['b'] }, visualMap, series: [heatmap] }), []);
	assert.deepEqual(ruled({ xAxis: { data: ['a'] }, yAxis: {}, visualMap, series: [heatmap] }), [
		'error CFG_REQUIRES $.series[0]'
	]);
	assert.deepEqual(
		ruled({ ...grid, xAxis: { type: 'category', data: ['a'], boundaryGap: false }, visualMap, series: [heatmap] }),
		['error CFG_REQUIRES $.series[0]']
	);
	// Other coordinate systems and unreadable axes make no claim.
	assert.deepEqual(ruled({ calendar: {}, visualMap, series: [{ ...heatmap, coordinateSystem: 'calendar' }] }), []);
	assert.deepEqual(
		ruled({
			xAxis: Object.defineProperty({}, 'type', { get: () => 'value' }),
			yAxis: grid.yAxis,
			visualMap,
			series: [heatmap]
		}),
		[]
	);
});

test('cartesian series: the axis index a series refers to must exist', () => {
	assert.deepEqual(ruled({ series: [{ type: 'bar', data: [1] }] }), [
		'error CFG_REQUIRES $.series[0]',
		'error CFG_REQUIRES $.series[0]'
	]);
	assert.deepEqual(ruled({ xAxis: {}, series: { type: 'line', data: [1] } }), ['error CFG_REQUIRES $.series']);
	assert.deepEqual(ruled({ ...axes, series: [{ type: 'line', yAxisIndex: 1, data: [1] }] }), [
		'error CFG_REQUIRES $.series[0]'
	]);
	assert.deepEqual(ruled({ xAxis: {}, yAxis: [{}, {}], series: [{ type: 'line', yAxisIndex: 1, data: [1] }] }), []);
	const [finding] = validate({ xAxis: {}, series: [{ type: 'scatter', data: [] }] }).diagnostics.filter(
		(d) => d.code === 'CFG_REQUIRES'
	);
	assert.equal(
		finding.message,
		'A scatter series on cartesian2d needs yAxis 0; the runtime throws ("yAxis "0" not found").'
	);
	assert.equal(finding.suggestion, 'Add yAxis.');
});

test('cartesian series: other coordinate systems, axis ids and series types without a cartesian default make no claim', () => {
	for (const series of [
		{ type: 'pie', data: [1] },
		{ type: 'line', coordinateSystem: 'polar', data: [1] },
		{ type: 'line', xAxisId: 'x', yAxisId: 'y', data: [1] },
		{ type: 'scatter', coordinateSystem: 'geo', data: [] }
	])
		assert.deepEqual(ruled({ series: [series] }), [], JSON.stringify(series));
	// Only the axis referred to by id is out of reach; the other one is still checked.
	assert.deepEqual(ruled({ series: [{ type: 'line', xAxisId: 'x', data: [1] }] }), ['error CFG_REQUIRES $.series[0]']);
	assert.deepEqual(
		ruled({ xAxis: Object.defineProperty({}, 'type', { get: () => 'value' }), yAxis: {}, series: [{ type: 'line' }] }),
		[]
	);
});

test('legend: a name that matches no series and no data item the runtime reads names from is a warning', () => {
	const option = {
		legend: { data: ['Sales', 'Costs', 'Apples', '', '\n', { name: 'Pears' }, 'Sales'] },
		series: [
			{ name: 'Sales', type: 'line', data: [1] },
			{ type: 'pie', data: [{ name: 'Apples', value: 1 }, { name: 'Pears', value: 2 }, 3] }
		],
		...axes
	};
	assert.deepEqual(ruled(option), ['warning CFG_UNKNOWN_REFERENCE $.legend.data[1]']);
	const [finding] = validate({
		...axes,
		legend: [{ data: ['Sale'] }],
		series: [{ name: 'Sales', type: 'bar', data: [1] }]
	}).diagnostics;
	assert.deepEqual(
		[finding.code, finding.path, finding.confidence, finding.suggestion],
		['CFG_UNKNOWN_REFERENCE', '$.legend[0].data[0]', 'certain', 'Did you mean "Sales"?']
	);
});

test('legend: names come from series names, and from data, nodes, categories or tuple names of the types that use them', () => {
	const named = (type, extra) => ({ legend: { data: ['A'] }, series: [{ type, ...extra }] });
	for (const [type, extra] of [
		['funnel', { data: [{ name: 'A', value: 1 }] }],
		['radar', { data: [{ name: 'A', value: [1] }] }],
		['graph', { categories: [{ name: 'A' }], data: [] }],
		['chord', { nodes: [{ name: 'A' }] }],
		['themeRiver', { data: [['2024-01-01', 1, 'A']] }]
	])
		assert.deepEqual(ruled(named(type, extra)), [], type);
	assert.deepEqual(ruled({ ...axes, legend: { data: ['5'] }, series: [{ name: 5, type: 'line', data: [1] }] }), []);
	// A data item may be called anything, including what a sentinel for "no name" could have been.
	assert.deepEqual(
		ruled({
			legend: { data: ['none', 'null'] },
			series: [{ type: 'pie', data: [{ name: 'none', value: 1 }, { name: 'null', value: 2 }, 3] }]
		}),
		[]
	);
});

test('legend: names the rule cannot read (a dataset, a getter, an unknown type) make no claim at all', () => {
	for (const series of [
		{ type: 'pie', datasetIndex: 0 },
		{ type: 'pie', data: [Object.defineProperty({}, 'name', { get: () => 'A' })] },
		{ type: 'wordCloud', data: [{ name: 'A' }] },
		Object.defineProperty({ type: 'line' }, 'name', { get: () => 'A' })
	])
		assert.deepEqual(ruled({ ...axes, legend: { data: ['A'] }, series: [series] }), [], JSON.stringify(series));
});

test('a timeline option (baseOption / options) is merged at runtime: the rules make no claim on its parts', () => {
	assert.deepEqual(ruled({ baseOption: { series: [heatmap] }, options: [{ visualMap: {} }] }), []);
	assert.deepEqual(ruled({ options: [{ series: [heatmap] }] }), []);
});

test('a root option with media is merged at runtime with the matching media options: no claim on the root alone (H10)', () => {
	// echarts takes the root as the base option and merges each matching `media[].option` into it.
	assert.deepEqual(ruled({ series: [heatmap], media: [{ query: { maxWidth: 500 }, option: { visualMap: {} } }] }), []);
	assert.deepEqual(
		ruled({
			legend: { data: ['Small'] },
			series: [{ type: 'line', data: [1] }],
			media: [{ option: { series: [{ name: 'Small' }] } }]
		}),
		[]
	);
	assert.deepEqual(ruled({ series: [heatmap], media: Object.defineProperty({}, 'length', { get: () => 1 }) }), []);
	// A falsy media is none (`hasMedia = !!rawOption.media`): the rules apply.
	assert.equal(ruled({ series: [heatmap], media: null }).length > 0, true);
});

test('incomplete input (static extraction) turns rule errors into unresolved warnings', () => {
	assert.deepEqual(
		validate({ series: [heatmap] }, { incomplete: true })
			.diagnostics.filter((d) => d.code === 'CFG_REQUIRES')
			.map((d) => `${d.severity} ${d.confidence}`),
		['warning unknown', 'warning unknown', 'warning unknown']
	);
});
