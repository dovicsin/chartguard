import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

const codes = (config) => analyze(config).diagnostics.map((d) => `${d.code} ${d.path}`);
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

test('a horizontal layout, a missing axis or another coordinate system leaves the value axis unmodelled', () => {
	const valueAxis = (option) => brief(normalize(option).series.items[0].valueAxis);
	assert.equal(
		valueAxis({ xAxis: { type: 'value' }, yAxis: { type: 'category' }, series: [{ type: 'bar' }] }),
		'? unmodelled $.series[0].yAxisIndex'
	);
	assert.equal(
		valueAxis({ xAxis: {}, yAxis: { data: ['a'] }, series: [{ type: 'bar' }] }),
		'? unmodelled $.series[0].yAxisIndex'
	);
	assert.equal(valueAxis({ yAxis: {}, series: [{ type: 'bar' }] }), '? unmodelled $.series[0].yAxisIndex');
	assert.equal(
		valueAxis({ ...CATEGORY, yAxis: {}, series: [{ type: 'bar', coordinateSystem: 'polar' }] }),
		'? unmodelled $.series[0].yAxisIndex'
	);
	// An x axis with data defaults to category (the runtime's own rule): a vertical bar.
	assert.equal(
		valueAxis({ xAxis: { data: ['a'] }, yAxis: {}, series: [{ type: 'bar' }] }),
		'yAxis[0] default $.series[0].yAxisIndex'
	);
	assert.equal(
		valueAxis({ xAxis: {}, yAxis: {}, series: [{ type: 'scatter' }] }),
		'yAxis[0] default $.series[0].yAxisIndex'
	);
	// Horizontal bars with a minimum on their category axis: no baseline claim (the starter claimed one).
	assert.deepEqual(
		codes({ xAxis: { type: 'value' }, yAxis: { type: 'category', min: 3 }, series: [{ type: 'bar' }] }),
		[]
	);
});

test('axes: both directions, keyed by index, at the path they are configured', () => {
	const { axes } = normalize({ xAxis: { data: ['a'], name: 'Day' }, yAxis: [{ min: 3, max: 'dataMax' }, {}] });
	assert.deepEqual(
		axes.map(({ key, path, min, max, title }) => [key, path, brief(min), brief(max), brief(title)]),
		[
			['xAxis[0]', '$.xAxis', '? unset $.xAxis.min', '? unset $.xAxis.max', 'Day config $.xAxis.name'],
			['yAxis[0]', '$.yAxis[0]', '3 config $.yAxis[0].min', '? shape $.yAxis[0].max', '? unset $.yAxis[0].name'],
			['yAxis[1]', '$.yAxis[1]', '? unset $.yAxis[1].min', '? unset $.yAxis[1].max', '? unset $.yAxis[1].name']
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
		[]
	);
	assert.deepEqual(codes({ ...CATEGORY, yAxis: [{ min: 0 }, { min: 3 }], series: [{ type: 'bar', yAxisIndex: 1 }] }), [
		'VIS_BAR_BASELINE $.yAxis[1].min'
	]);
});

test('every runtime default points at the line of the pinned echarts that applies it', () =>
	assert.equal(checkPointers(fileURLToPath(new URL('../src/index.ts', import.meta.url))), 3));
