import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPointers } from '../../core/tests/pointers.mjs';
import { analyze, normalize } from '../dist/index.js';

const codes = (config) => analyze(config).diagnostics.map((d) => `${d.code} ${d.path}`);
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;

test('an empty config is an advisory report; the default title is "Chart title"', () => {
	assert.equal(analyze({}).library, 'highcharts');
	assert.deepEqual(analyze({}).diagnostics, []);
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
	assert.equal(
		brief(normalize({ chart: { polar: true }, series: [{ type: 'column' }] }).series.items[0].valueAxis),
		'? unmodelled $.series[0].yAxis'
	);
});

test('wrongly typed or dynamic facts stay unknown', () => {
	const chart = normalize({ chart: { type: 'bar' }, yAxis: { min: 'x' }, title: { text: () => 'T' }, series: [{}] });
	assert.equal(brief(chart.axes.find(({ key }) => key === 'yAxis[0]').min), '? shape $.yAxis.min');
	assert.equal(brief(chart.title.text), '? dynamic $.title.text');
});

test('findings point at the Highcharts option; horizontal bar charts measure on the y axis too', () => {
	assert.deepEqual(codes({ chart: { type: 'bar' }, yAxis: { min: 2 }, title: { text: '' }, series: [{ data: [1] }] }), [
		'VIS_BAR_BASELINE $.yAxis.min',
		'VIS_EMPTY_TITLE $.title.text'
	]);
	assert.deepEqual(
		codes({
			chart: { type: 'column' },
			yAxis: [{ min: 0 }, { id: 'r', min: 5 }],
			series: [{}, { type: 'line', yAxis: 'r' }]
		}),
		[]
	);
	assert.deepEqual(codes({ yAxis: [{ min: 0 }, { min: 5 }], series: [{ type: 'column', yAxis: 1 }] }), [
		'VIS_BAR_BASELINE $.yAxis[1].min'
	]);
	// The default title is not an empty one; no bar series, no baseline claim.
	assert.deepEqual(codes({ chart: { type: 'column' }, yAxis: { min: 2 } }), []);
});

test('every runtime default points at the line of the pinned highcharts that applies it', () =>
	assert.equal(checkPointers(fileURLToPath(new URL('../src/index.ts', import.meta.url))), 3));
