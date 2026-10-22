import assert from 'node:assert/strict';
import test from 'node:test';

import { checkPackagePointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

/** The label rules (CG-05-04 part 3) fire on most bare test configs; they have tests of their own. */
const LABELS = new Set(['VIS_PLACEHOLDER_TEXT', 'VIS_VALUE_AXIS_UNTITLED']);
const codes = (config) =>
	analyze(config)
		.diagnostics.filter((d) => !LABELS.has(d.code))
		.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const CATEGORY = { xAxis: { type: 'category', data: ['a'] } };

test('an empty option is an advisory report with no findings', () => {
	assert.equal(analyze({}).library, 'echarts');
	assert.deepEqual(analyze({}).diagnostics, []);
});

test('series: kind, name and the axis their values are measured on (by index, by id, else the first)', () => {
	const { series } = normalize({
		...CATEGORY,
		yAxis: [{}, { id: 'right' }],
		series: [
			{ type: 'bar', name: 'Sales' },
			{ type: 'line', yAxisIndex: 1 },
			{ type: 'line', yAxisId: 'right' },
			{ type: 'pie' },
			{ type: 'sankey' },
			{ type: 'line', yAxisId: 'nope' }
		]
	});
	assert.deepEqual(
		series.items.map(({ kind, name, valueAxis }) => [brief(kind), brief(name), brief(valueAxis)]),
		[
			['bar config $.series[0].type', 'Sales config $.series[0].name', 'yAxis[0] default $.series[0].yAxisIndex'],
			['line config $.series[1].type', '? unset $.series[1].name', 'yAxis[1] config $.series[1].yAxisIndex'],
			['line config $.series[2].type', '? unset $.series[2].name', 'yAxis[1] config $.series[2].yAxisId'],
			['pie config $.series[3].type', '? unset $.series[3].name', '? inapplicable $.series[3].yAxisIndex'],
			['other config $.series[4].type', '? unset $.series[4].name', '? unmodelled $.series[4].yAxisIndex'],
			['line config $.series[5].type', '? unset $.series[5].name', '? unmodelled $.series[5].yAxisId']
		]
	);
	assert.equal(normalize({ series: { type: 'bar' } }).series.items[0].path, '$.series');
});

test('orientation from the axis types: the measuring axis carries the values; vertical and horizontal grids', () => {
	const layout = (option) => {
		const { orientation, valueAxis, coordinateSystem } = normalize(option).series.items[0];
		return [brief(coordinateSystem), brief(orientation), brief(valueAxis)];
	};
	assert.deepEqual(layout({ ...CATEGORY, yAxis: {}, series: [{ type: 'bar' }] }), [
		'cartesian default $.series[0].coordinateSystem',
		'vertical default $.yAxis.type',
		'yAxis[0] default $.series[0].yAxisIndex'
	]);
	assert.deepEqual(
		layout({ xAxis: { type: 'value' }, yAxis: { type: 'category' }, series: [{ type: 'bar', xAxisIndex: 0 }] }),
		[
			'cartesian default $.series[0].coordinateSystem',
			'horizontal config $.xAxis.type',
			'xAxis[0] config $.series[0].xAxisIndex'
		]
	);
	// A y axis with data is a category axis by the runtime's own default.
	assert.deepEqual(layout({ xAxis: {}, yAxis: { data: ['a'] }, series: [{ type: 'bar' }] }).slice(1), [
		'horizontal default $.xAxis.type',
		'xAxis[0] default $.series[0].xAxisIndex'
	]);
	assert.deepEqual(layout({ xAxis: {}, yAxis: {}, series: [{ type: 'scatter' }] }).slice(1), [
		'vertical default $.yAxis.type',
		'yAxis[0] default $.series[0].yAxisIndex'
	]);
	// Two measuring axes for a bar, a missing axis, polar: not modelled.
	assert.deepEqual(layout({ xAxis: {}, yAxis: {}, series: [{ type: 'bar' }] }).slice(1), [
		'? unmodelled $.series[0]',
		'? unmodelled $.series[0].yAxisIndex'
	]);
	assert.deepEqual(layout({ yAxis: {}, series: [{ type: 'bar' }] }).slice(1), [
		'? unmodelled $.series[0]',
		'? unmodelled $.series[0].yAxisIndex'
	]);
	assert.deepEqual(layout({ ...CATEGORY, yAxis: {}, series: [{ type: 'bar', coordinateSystem: 'polar' }] }), [
		'polar config $.series[0].coordinateSystem',
		'? unmodelled $.series[0]',
		'? unmodelled $.series[0].yAxisIndex'
	]);
	assert.deepEqual(
		layout({ series: [{ type: 'bar', coordinateSystem: 'calendar' }] })[0],
		'? unmodelled $.series[0].coordinateSystem'
	);
});

test('a horizontal bar is measured on its x axis: its baseline is the x minimum, not the category y one', () => {
	assert.deepEqual(
		codes({ xAxis: { type: 'value' }, yAxis: { type: 'category', min: 3 }, series: [{ type: 'bar' }] }),
		[]
	);
	assert.deepEqual(
		codes({ xAxis: { type: 'value', min: 3 }, yAxis: { type: 'category' }, series: [{ type: 'bar' }] }),
		['VIS_BAR_BASELINE $.xAxis.min']
	);
});

test('area and stacking: areaStyle draws an area; a non-empty stack stacks', () => {
	const series = (extra) => normalize({ ...CATEGORY, yAxis: {}, series: [{ type: 'line', ...extra }] }).series.items[0];
	assert.equal(brief(series({}).kind), 'line config $.series[0].type');
	assert.equal(brief(series({ areaStyle: {} }).kind), 'area config $.series[0].areaStyle');
	assert.equal(brief(series({ areaStyle: null }).kind), 'line config $.series[0].type');
	assert.equal(brief(series({}).stacking), 'none default $.series[0].stack');
	assert.equal(brief(series({ stack: 'total' }).stacking), 'stacked config $.series[0].stack');
	assert.equal(brief(series({ stack: '' }).stacking), 'none config $.series[0].stack');
	assert.equal(
		brief(normalize({ series: [{ type: 'pie', stack: 'x' }] }).series.items[0].stacking),
		'? inapplicable $.series[0].stack'
	);
});

test('axes: both directions, keyed by index, at the path they are configured', () => {
	const { axes } = normalize({ xAxis: { data: ['a'], name: 'Day' }, yAxis: [{ min: 3, max: 'dataMax' }, {}] });
	assert.deepEqual(
		axes.map(({ key, path, min, max, title }) => [key, path, brief(min), brief(max), brief(title.text)]),
		[
			['xAxis[0]', '$.xAxis', '? unset $.xAxis.min', '? unset $.xAxis.max', 'Day config $.xAxis.name'],
			['yAxis[0]', '$.yAxis[0]', '3 config $.yAxis[0].min', 'data config $.yAxis[0].max', ' default $.yAxis[0].name'],
			['yAxis[1]', '$.yAxis[1]', '? unset $.yAxis[1].min', '? unset $.yAxis[1].max', ' default $.yAxis[1].name']
		]
	);
});

test('axes: scale from the axis type (with data: category), dataMin/dataMax as the data, inverse defaults to false', () => {
	const [x, y, y1] = normalize({
		xAxis: { data: ['a'] },
		yAxis: [{ type: 'log', min: 'dataMin', inverse: true }, { min: () => 0 }]
	}).axes;
	assert.deepEqual(
		[x, y, y1].map(({ scale, min, reversed }) => [brief(scale), brief(min), brief(reversed)]),
		[
			['category default $.xAxis.type', '? unset $.xAxis.min', 'false default $.xAxis.inverse'],
			['log config $.yAxis[0].type', 'data config $.yAxis[0].min', 'true config $.yAxis[0].inverse'],
			['linear default $.yAxis[1].type', '? dynamic $.yAxis[1].min', 'false default $.yAxis[1].inverse']
		]
	);
});

test('the title: shown by default; several titles stay unknown instead of guessing one', () => {
	assert.equal(brief(normalize({ title: { text: 'T' } }).title.shown), 'true default $.title.show');
	const several = normalize({ title: [{ text: '' }] }).title;
	assert.deepEqual([brief(several.text), brief(several.shown)], ['? unmodelled $.title', '? unmodelled $.title']);
	assert.deepEqual(codes({ title: { text: '', show: false } }), []);
});

test('findings point at the ECharts option that triggered them', () => {
	assert.deepEqual(codes({ ...CATEGORY, yAxis: { min: 3 }, series: [{ type: 'bar' }], title: { text: ' ' } }), [
		'VIS_BAR_BASELINE $.yAxis.min',
		'VIS_EMPTY_TITLE $.title.text'
	]);
	assert.deepEqual(
		codes({ ...CATEGORY, yAxis: [{ min: 0 }, { min: 3 }], series: [{ type: 'bar' }, { type: 'line', yAxisIndex: 1 }] }),
		// The line's axis starts at 3, but no bar is measured on it; two value axes are noted.
		['VIS_DUAL_AXIS $.series[1].yAxisIndex']
	);
	assert.deepEqual(codes({ ...CATEGORY, yAxis: [{ min: 0 }, { min: 3 }], series: [{ type: 'bar', yAxisIndex: 1 }] }), [
		'VIS_BAR_BASELINE $.yAxis[1].min'
	]);
});

test('every runtime default points at the line of the pinned echarts that applies it', () =>
	assert.equal(checkPackagePointers(import.meta.url), 13));

test('titles: no title draws none; an axis name is shown with its axis', () => {
	const { title, axes } = normalize({ xAxis: { data: ['a'], show: false, name: 'Day' }, yAxis: {} });
	assert.deepEqual([brief(title.text), brief(title.shown)], [' default $.title.text', 'true default $.title.show']);
	assert.deepEqual(
		axes.map(({ title: { text, shown } }) => [brief(text), brief(shown)]),
		[
			['Day config $.xAxis.name', 'false config $.xAxis.show'],
			[' default $.yAxis.name', 'true default $.yAxis.show']
		]
	);
});
