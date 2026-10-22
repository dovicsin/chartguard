import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../dist/index.js';

/** Highcharts fixes (CG-05-06): each remedy, and where none is offered. */
const fixes = (config) =>
	analyze(config).diagnostics.map(
		({ code, fix }) =>
			`${code} ${fix === undefined ? '-' : `${fix.path} ${JSON.stringify(fix.from)}→${JSON.stringify(fix.value)}`}`
	);
const chart = (extra = {}, yAxis = {}) => ({
	chart: { type: 'column' },
	title: { text: 'T' },
	palette: { colors: ['#1f77b4', '#d62728'] },
	yAxis: { title: { text: 'U' }, ...yAxis },
	series: [{ data: [60, 70] }],
	...extra
});

test('bar baseline: a bound or threshold to 0; log to linear; a reversal off', () => {
	assert.deepEqual(fixes(chart({}, { min: 50 })), ['VIS_BAR_BASELINE $.yAxis.min 50→0']);
	assert.deepEqual(fixes(chart({ series: [{ data: [60, 70], threshold: 20 }] })), [
		'VIS_BAR_BASELINE $.series[0].threshold 20→0'
	]);
	assert.deepEqual(fixes(chart({ plotOptions: { column: { threshold: 20 } } })), [
		'VIS_BAR_BASELINE $.plotOptions.column.threshold 20→0'
	]);
	assert.deepEqual(fixes(chart({}, { type: 'logarithmic' })), [
		'VIS_BAR_LOG_SCALE $.yAxis.type "logarithmic"→"linear"'
	]);
	assert.deepEqual(fixes(chart({ chart: { type: 'line' } }, { reversed: true })), [
		'VIS_REVERSED_VALUE_AXIS $.yAxis.reversed true→false'
	]);
});

test('accessibility and keyboard back on: one edit resolves both findings it shares', () => {
	assert.deepEqual(fixes(chart({ accessibility: { enabled: false } })), [
		'VIS_DATA_NOT_DESCRIBED $.accessibility.enabled false→true',
		'VIS_KEYBOARD_DISABLED $.accessibility.enabled false→true'
	]);
	assert.deepEqual(fixes(chart({ accessibility: { keyboardNavigation: { enabled: false } } })), [
		'VIS_KEYBOARD_DISABLED $.accessibility.keyboardNavigation.enabled false→true'
	]);
});

test('long animations: the duration that decides to one second, where the series options merge', () => {
	assert.deepEqual(fixes(chart({ plotOptions: { series: { animation: { duration: 8000 } } } })), [
		'VIS_LONG_MOTION $.plotOptions.series.animation.duration 8000→1000'
	]);
	// An object without a duration merges over the one below: the lower duration decides, and is the one fixed.
	const over = chart({
		plotOptions: { series: { animation: { duration: 8000 } } },
		series: [{ data: [1, 2], animation: { defer: 10 } }]
	});
	assert.deepEqual(fixes(over), ['VIS_LONG_MOTION $.plotOptions.series.animation.duration 8000→1000']);
	// Two series with their own long durations: one edit cannot resolve the finding.
	const two = chart({
		series: [
			{ data: [1], animation: { duration: 7000 } },
			{ data: [2], animation: { duration: 9000 } }
		]
	});
	assert.deepEqual(fixes(two), ['VIS_LONG_MOTION -']);
});

test('percent without unit: {value}% only where the axis has no format of its own', () => {
	const percent = (labels) =>
		chart(
			{ plotOptions: { series: { stacking: 'percent' } }, series: [{ data: [1, 2] }, { data: [2, 1] }] },
			{ title: { text: 'Share' }, ...labels }
		);
	assert.deepEqual(fixes(percent({})), ['VIS_PERCENT_WITHOUT_UNIT $.yAxis.labels.format undefined→"{value}%"']);
	assert.deepEqual(fixes(percent({ labels: { format: '{text} pct' } })), ['VIS_PERCENT_WITHOUT_UNIT -']);
});

test('no fix where the finding needs the author', () => {
	assert.deepEqual(fixes({ ...chart(), title: undefined }), ['VIS_PLACEHOLDER_TEXT -']);
	assert.deepEqual(fixes({ ...chart(), title: { text: '' } }), ['VIS_EMPTY_TITLE -']);
});
