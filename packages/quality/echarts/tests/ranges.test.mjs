import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const bars = (data, yAxis = {}, { series = {}, more = [], root = {} } = {}) => ({
	xAxis: { type: 'category', data: data.map(String) },
	yAxis,
	series: [{ type: 'bar', data, ...series }, ...more],
	...root
});
const fit = (config, key = 'yAxis[0]') => brief(normalize(config).axes.find((axis) => axis.key === key).fit);
const baselines = (config) =>
	analyze(config)
		.diagnostics.filter(({ code }) => code === 'VIS_BAR_BASELINE')
		.map(({ path }) => path);

test('scale: true fits the range to the data with a nice interval of span / splitNumber; it does not depend on the size', () => {
	assert.equal(fit(bars([60, 70], { scale: true })), 'excluded config $.yAxis.scale');
	assert.deepEqual(baselines(bars([60, 70], { scale: true })), ['$.yAxis.scale']);
	assert.equal(fit(bars([5, 70], { scale: true })), 'included config $.yAxis.scale');
	assert.deepEqual(baselines(bars([5, 70], { scale: true })), []);
	assert.equal(fit(bars([-60, -70], { scale: true })), 'excluded config $.yAxis.scale');
	// A single value is widened by half of it each way; zero becomes [0, 1].
	assert.equal(fit(bars([50], { scale: true })), 'excluded config $.yAxis.scale');
	assert.equal(fit(bars([0], { scale: true })), 'included config $.yAxis.scale');
	// splitNumber sets the interval: one split of 70 is 100 (from 0), ten splits are 7 → 5 (from 30).
	assert.equal(fit(bars([30, 100], { scale: true, splitNumber: 1 })), 'included config $.yAxis.scale');
	assert.equal(fit(bars([30, 100], { scale: true, splitNumber: 10 })), 'excluded config $.yAxis.scale');
	assert.equal(
		fit(bars([60, 70], { scale: true }, { more: [{ type: 'line', data: [1, 2] }] })),
		'included config $.yAxis.scale'
	);
	assert.equal(fit(bars([60, 70], [{ scale: true }])), 'excluded config $.yAxis[0].scale');
	const horizontal = {
		yAxis: { type: 'category', data: ['a', 'b'] },
		xAxis: { scale: true },
		series: [{ type: 'bar', data: [60, 70] }]
	};
	assert.equal(fit(horizontal, 'xAxis[0]'), 'excluded config $.xAxis.scale');
});

test('a fitted range claims nothing where the config does not ask for it or the range is not modelled', () => {
	assert.equal(fit(bars([60, 70])), '? unset $.yAxis.scale');
	assert.equal(fit(bars([60, 70], { scale: false })), '? inapplicable $.yAxis.scale');
	assert.equal(fit(bars([60, 70], { scale: true, type: 'log' })), '? inapplicable $.yAxis.scale');
	for (const option of [{ min: 10 }, { boundaryGap: ['10%', '10%'] }, { minInterval: 50 }, { startValue: 0 }])
		assert.equal(fit(bars([60, 70], { scale: true, ...option })), '? unmodelled $.yAxis.scale', JSON.stringify(option));
	assert.equal(fit(bars([60, 70], { scale: true }, { root: { dataZoom: [{}] } })), '? unmodelled $.yAxis.scale');
	assert.equal(fit(bars([60, 70], { scale: true }, { series: { stack: 'a' } })), '? unmodelled $.yAxis.scale');
	assert.equal(fit(bars([60, 70], { scale: true, splitNumber: () => 3 })), '? dynamic $.yAxis.scale');
	assert.deepEqual(baselines(bars([60, 70], { scale: true, min: 10 })), ['$.yAxis.min']);
	// The interval lands on the data minimum (60 / 20 = 3): the floating-point result is not claimed.
	assert.equal(fit(bars([20, 60], { scale: true, splitNumber: 2 })), '? unmodelled $.yAxis.scale');
});

test('a series a legend may hide is not in the data range: echarts filters it out before the axis fits (K11)', () => {
	const low = { type: 'line', name: 'Low', data: [1, 2] };
	const withLegend = (legend) => bars([60, 70], { scale: true }, { more: [low], root: { legend } });
	assert.equal(fit(withLegend({})), 'included config $.yAxis.scale');
	assert.equal(fit(withLegend({ selected: { Low: true, Other: false } })), 'included config $.yAxis.scale');
	assert.equal(fit(withLegend({ selected: { Low: false } })), '? unmodelled $.yAxis.scale');
	// Any legend that leaves it unselected hides it, with any falsy value.
	assert.equal(fit(withLegend([{}, { selected: { Low: 0 } }])), '? unmodelled $.yAxis.scale');
	// A single-select legend shows one series only.
	assert.equal(fit(withLegend({ selectedMode: 'single' })), '? unmodelled $.yAxis.scale');
	assert.equal(fit(withLegend({ selectedMode: true })), 'included config $.yAxis.scale');
	// A series without a name is listed as `series\0` and its index.
	const unnamed = bars(
		[60, 70],
		{ scale: true },
		{ more: [{ type: 'line', data: [1, 2] }], root: { legend: { selected: { 'series\u00001': false, Low: false } } } }
	);
	assert.equal(fit(unnamed), '? unmodelled $.yAxis.scale');
	assert.equal(
		fit({ ...unnamed, legend: { selected: { 'series\u00000': true, Low: false } } }),
		'included config $.yAxis.scale'
	);
	const hidden = Object.defineProperty({}, 'Low', { get: () => false, enumerable: true });
	assert.equal(fit(withLegend({ selected: hidden })), '? accessor $.yAxis.scale');
	assert.equal(
		fit(withLegend(Object.defineProperty({}, 'selected', { get: () => ({}), enumerable: true }))),
		'? accessor $.yAxis.scale'
	);
});

test('base: bars grow from the startValue of their value axis, zero by default; reported once per axis', () => {
	const bases = (config) => normalize(config).series.items.map(({ base }) => brief(base));
	assert.deepEqual(bases(bars([60])), ['0 default $.yAxis.startValue']);
	assert.deepEqual(bases(bars([60], { startValue: 20 })), ['20 config $.yAxis.startValue']);
	assert.deepEqual(bases(bars([60], [{ startValue: 20 }])), ['20 config $.yAxis[0].startValue']);
	assert.deepEqual(bases(bars([60], { type: 'log' })), ['? inapplicable $.series[0].base']);
	assert.deepEqual(bases(bars([60], {}, { more: [{ type: 'line', data: [1] }] })), [
		'0 default $.yAxis.startValue',
		'? inapplicable $.series[1].base'
	]);
	const two = {
		...bars([60], { startValue: 20 }),
		series: [
			{ type: 'bar', data: [60] },
			{ type: 'bar', data: [50] }
		]
	};
	assert.deepEqual(baselines(two), ['$.yAxis.startValue']);
});

test('unit: a formatter template is the unit around its first {value}; a function decides at runtime', () => {
	const unit = (config, key = 'yAxis[0]') => brief(normalize(config).axes.find((axis) => axis.key === key).unit);
	assert.equal(unit(bars([1])), ' default $.yAxis.axisLabel.formatter');
	assert.equal(unit(bars([1], { axisLabel: { formatter: '{value} %' } })), '% config $.yAxis.axisLabel.formatter');
	// Only the first {value} is replaced; the second is shown as it is.
	assert.equal(
		unit(bars([1], { axisLabel: { formatter: '{value}{value}kg' } })),
		'{value}kg config $.yAxis.axisLabel.formatter'
	);
	assert.equal(unit(bars([1], { axisLabel: { formatter: 'x' } })), '? unmodelled $.yAxis.axisLabel.formatter');
	assert.equal(unit(bars([1], { axisLabel: { formatter: () => 'x' } })), '? dynamic $.yAxis.axisLabel.formatter');
	assert.equal(unit(bars([1]), 'xAxis[0]'), '? unmodelled $.xAxis.axisLabel.formatter');
});
