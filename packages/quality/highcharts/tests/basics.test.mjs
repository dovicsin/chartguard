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

test('an empty config draws the placeholder "Chart title": it is the only finding', () => {
	assert.equal(analyze({}).library, 'highcharts');
	assert.deepEqual(
		analyze({}).diagnostics.map((d) => `${d.code} ${d.path}`),
		['VIS_PLACEHOLDER_TEXT $.title.text']
	);
	assert.equal(brief(normalize({}).title.text), 'Chart title default $.title.text');
});

test('series: type from the series, else the chart, else line; the y axis they bind by index or id, else the first', () => {
	const { series } = normalize({
		chart: { type: 'column' },
		yAxis: [{}, { id: 'right' }],
		series: [
			{ name: 'Visits' },
			{ type: 'spline', yAxis: 1 },
			{ type: 'areaspline', yAxis: 'right' },
			{ type: 'pie' },
			{ type: 'sankey' },
			{ type: 'line', yAxis: 'nope' }
		]
	});
	assert.deepEqual(
		series.items.map(({ type, kind, valueAxis }) => [brief(type), brief(kind), brief(valueAxis)]),
		[
			['column config $.chart.type', 'bar config $.chart.type', 'yAxis[0] default $.series[0].yAxis'],
			['spline config $.series[1].type', 'line config $.series[1].type', 'yAxis[1] config $.series[1].yAxis'],
			['areaspline config $.series[2].type', 'area config $.series[2].type', 'yAxis[1] config $.series[2].yAxis'],
			['pie config $.series[3].type', 'pie config $.series[3].type', '? inapplicable $.series[3].yAxis'],
			['sankey config $.series[4].type', 'other config $.series[4].type', '? unmodelled $.series[4].yAxis'],
			['line config $.series[5].type', 'line config $.series[5].type', '? unmodelled $.series[5].yAxis']
		]
	);
	assert.equal(brief(normalize({ series: [{}] }).series.items[0].type), 'line default $.chart.type');
	// Without yAxis options Highcharts creates one: the series is measured on it.
	assert.equal(brief(normalize({ series: [{}] }).series.items[0].valueAxis), 'yAxis[0] default $.series[0].yAxis');
	// In a polar chart the y axis is the radial value axis.
	assert.equal(
		brief(normalize({ chart: { polar: true }, series: [{ type: 'column' }] }).series.items[0].valueAxis),
		'yAxis[0] default $.series[0].yAxis'
	);
});

test('axes: type defaults to linear; y axes are not reversed unless set, x axes of inverted charts are left unknown', () => {
	const { axes } = normalize({
		xAxis: { categories: ['a'] },
		yAxis: [{ type: 'logarithmic' }, { type: 'datetime', reversed: true }, { type: 'treegrid' }]
	});
	assert.deepEqual(
		axes.map(({ key, scale, reversed }) => [key, brief(scale), brief(reversed)]),
		[
			['xAxis[0]', 'linear default $.xAxis.type', '? unset $.xAxis.reversed'],
			['yAxis[0]', 'log config $.yAxis[0].type', 'false default $.yAxis[0].reversed'],
			['yAxis[1]', 'time config $.yAxis[1].type', 'true config $.yAxis[1].reversed'],
			['yAxis[2]', 'other config $.yAxis[2].type', 'false default $.yAxis[2].reversed']
		]
	);
});

test('wrongly typed or dynamic facts stay unknown', () => {
	const chart = normalize({ chart: { type: 'bar' }, yAxis: { min: 'x' }, title: { text: () => 'T' }, series: [{}] });
	assert.equal(brief(chart.axes.find(({ key }) => key === 'yAxis[0]').min), '? shape $.yAxis.min');
	assert.equal(brief(chart.title.text), '? dynamic $.title.text');
});

test('findings point at the Highcharts option; horizontal bar charts measure on the y axis too', () => {
	assert.deepEqual(
		codes({
			chart: { type: 'bar' },
			yAxis: { min: 2, startOnTick: false },
			title: { text: '' },
			series: [{ data: [1] }]
		}),
		['VIS_BAR_BASELINE $.yAxis.min', 'VIS_EMPTY_TITLE $.title.text']
	);
	assert.deepEqual(
		codes({
			chart: { type: 'column' },
			yAxis: [{ min: 0 }, { id: 'r', min: 5, startOnTick: false }],
			series: [{}, { type: 'line', yAxis: 'r' }]
		}),
		['VIS_DUAL_AXIS $.series[1].yAxis']
	);
	assert.deepEqual(
		codes({ yAxis: [{ min: 0 }, { min: 5, startOnTick: false }], series: [{ type: 'column', yAxis: 1 }] }),
		['VIS_BAR_BASELINE $.yAxis[1].min']
	);
	// The default title is not an empty one; no bar series, no baseline claim.
	assert.deepEqual(codes({ chart: { type: 'column' }, yAxis: { min: 2, startOnTick: false } }), []);
});

test("coordinate system and orientation are the chart's: polar from chart.polar; inverted by chart.inverted or by any bar series", () => {
	const layout = (config) => {
		const { coordinateSystem, orientation } = normalize(config).series.items[0];
		return [brief(coordinateSystem), brief(orientation)];
	};
	assert.deepEqual(layout({ series: [{ type: 'column' }] }), [
		'cartesian default $.chart.polar',
		'vertical default $.chart.inverted'
	]);
	assert.deepEqual(layout({ chart: { inverted: true }, series: [{ type: 'column' }] }), [
		'cartesian default $.chart.polar',
		'horizontal config $.chart.inverted'
	]);
	assert.deepEqual(layout({ chart: { type: 'bar' }, series: [{}] })[1], 'horizontal config $.chart.type');
	// One bar series inverts every series of the chart, and `inverted: false` does not stop it.
	assert.deepEqual(
		layout({ chart: { inverted: false }, series: [{ type: 'line' }, { type: 'bar' }] })[1],
		'horizontal config $.series[1].type'
	);
	assert.deepEqual(
		layout({ series: [{ type: 'line' }, Object.defineProperty({}, 'type', { get: () => 'bar' })] })[1],
		'? accessor $.series[1].type'
	);
	assert.deepEqual(layout({ chart: { polar: true }, series: [{ type: 'column' }] }), [
		'polar config $.chart.polar',
		'? inapplicable $.series[0]'
	]);
	assert.deepEqual(layout({ series: [{ type: 'pie' }] }), ['? inapplicable $.series[0]', '? inapplicable $.series[0]']);
});

test('stacking resolves through the series, plotOptions for its type and plotOptions.series', () => {
	const stacking = (config) => brief(normalize(config).series.items[0].stacking);
	assert.equal(stacking({ series: [{ type: 'column' }] }), 'none default $.series[0].stacking');
	assert.equal(
		stacking({ plotOptions: { series: { stacking: 'normal' } }, series: [{ type: 'column' }] }),
		'stacked config $.plotOptions.series.stacking'
	);
	assert.equal(
		stacking({
			plotOptions: { series: { stacking: 'normal' }, column: { stacking: 'percent' } },
			series: [{ type: 'column' }]
		}),
		'percent config $.plotOptions.column.stacking'
	);
	assert.equal(
		stacking({ plotOptions: { column: { stacking: 'percent' } }, series: [{ type: 'column', stacking: null }] }),
		'none config $.series[0].stacking'
	);
	assert.equal(stacking({ series: [{ type: 'area', stacking: 'stream' }] }), '? unmodelled $.series[0].stacking');
});

test('every runtime default points at the line of the pinned highcharts that applies it', () =>
	assert.equal(checkPackagePointers(import.meta.url), 32));

test('titles: null hides a title; a y axis without text takes lang.yAxisTitle, else "Values"; an implicit y axis is read', () => {
	const hidden = normalize({ title: { text: null }, yAxis: { title: { text: null } } });
	assert.deepEqual(
		[brief(hidden.title.text), brief(hidden.title.shown)],
		[' config $.title.text', 'false config $.title.text']
	);
	const y = (config) => brief(normalize(config).axes.find(({ key }) => key === 'yAxis[0]').title.text);
	assert.equal(y({ yAxis: {} }), 'Values default $.yAxis.title.text');
	assert.equal(y({ lang: { yAxisTitle: 'Units' }, yAxis: {} }), 'Units config $.lang.yAxisTitle');
	assert.equal(y({}), 'Values default $.yAxis.title.text');
	assert.equal(
		brief(normalize({}).axes.find(({ key }) => key === 'xAxis[0]').title.text),
		'? unset $.xAxis.title.text'
	);
});

test('access: off with accessibility.enabled false; keyboard off by its own switch; otherwise the module decides', () => {
	const access = (config) => {
		const { dataDescribed, keyboard } = normalize(config).access;
		return [brief(dataDescribed), brief(keyboard)];
	};
	assert.deepEqual(access({}), [
		'? unmodelled $.accessibility.enabled',
		'? unmodelled $.accessibility.keyboardNavigation.enabled'
	]);
	assert.deepEqual(access({ accessibility: { enabled: false } }), [
		'false config $.accessibility.enabled',
		'false config $.accessibility.enabled'
	]);
	assert.deepEqual(access({ accessibility: { keyboardNavigation: { enabled: false } } }), [
		'? unmodelled $.accessibility.enabled',
		'false config $.accessibility.keyboardNavigation.enabled'
	]);
});
