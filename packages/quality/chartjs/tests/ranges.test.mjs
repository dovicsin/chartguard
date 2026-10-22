import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const bars = (data, y = {}, { dataset = {}, more = [], options = {} } = {}) => ({
	type: 'bar',
	data: { labels: data.map(String), datasets: [{ data, ...dataset }, ...more] },
	options: { scales: { y }, ...options }
});
const fit = (config) => brief(normalize(config).axes.find(({ key }) => key === 'y').fit);
const baselines = (config) =>
	analyze(config)
		.diagnostics.filter(({ code }) => code === 'VIS_BAR_BASELINE')
		.map(({ path }) => path);
const ASKED = '$.options.scales.y.beginAtZero';

test('beginAtZero: false fits the range to the data; zero is excluded, included, or depends on the size', () => {
	assert.equal(fit(bars([60, 70], { beginAtZero: false })), `excluded config ${ASKED}`);
	assert.deepEqual(baselines(bars([60, 70], { beginAtZero: false })), [ASKED]);
	assert.equal(fit(bars([5, 70], { beginAtZero: false })), `included config ${ASKED}`);
	assert.deepEqual(baselines(bars([5, 70], { beginAtZero: false })), []);
	// With 2 ticks the step is 100 and the range starts at 0; with 11 it is 10 and starts at 30.
	assert.equal(fit(bars([30, 100], { beginAtZero: false })), `? layout ${ASKED}`);
	assert.deepEqual(baselines(bars([30, 100], { beginAtZero: false })), []);
	// Negative bars: the range ends below zero.
	assert.equal(fit(bars([-60, -70], { beginAtZero: false })), `excluded config ${ASKED}`);
	// A single value is widened by 5 % each way.
	assert.equal(fit(bars([50], { beginAtZero: false })), `excluded config ${ASKED}`);
	// A line on the same scale pulls the range down to its values.
	assert.equal(
		fit(bars([60, 70], { beginAtZero: false }, { more: [{ type: 'line', data: [1, 2] }] })),
		`included config ${ASKED}`
	);
});

test('the tick limit and bounds are read: maxTicksLimit caps the sizes, bounds data keeps the data range', () => {
	assert.equal(fit(bars([30, 100], { beginAtZero: false, ticks: { maxTicksLimit: 2 } })), `included config ${ASKED}`);
	assert.equal(fit(bars([30, 100], { beginAtZero: false, ticks: { maxTicksLimit: 0 } })), `? layout ${ASKED}`);
	// Two ticks at the least: a limit of 1 draws 2 (step 20, from 0); a limit of 3 allows 2 or 3 (from 10).
	assert.equal(fit(bars([15, 30], { beginAtZero: false, ticks: { maxTicksLimit: 1 } })), `included config ${ASKED}`);
	assert.equal(fit(bars([15, 30], { beginAtZero: false, ticks: { maxTicksLimit: 3 } })), `? layout ${ASKED}`);
	assert.equal(fit(bars([5, 70], { beginAtZero: false, bounds: 'data' })), `excluded config ${ASKED}`);
	assert.equal(
		fit(bars([30, 100], { beginAtZero: false, ticks: { maxTicksLimit: 5.5 } })),
		'? unmodelled $.options.scales.y.ticks.maxTicksLimit'
	);
	assert.equal(fit(bars([5, 70], { beginAtZero: false, bounds: 'edge' })), '? unmodelled $.options.scales.y.bounds');
});

test('a fitted range claims nothing where the config does not ask for it or the range is not modelled', () => {
	assert.equal(fit(bars([60, 70])), `? unset ${ASKED}`);
	assert.equal(fit(bars([60, 70], { beginAtZero: true })), `? inapplicable ${ASKED}`);
	assert.equal(fit(bars([60, 70], { beginAtZero: false, type: 'logarithmic' })), `? inapplicable ${ASKED}`);
	for (const option of [{ min: 10 }, { suggestedMin: 0 }, { grace: '5%' }, { ticks: { stepSize: 5 } }])
		assert.equal(
			fit(bars([60, 70], { beginAtZero: false, ...option })),
			`? unmodelled ${ASKED}`,
			JSON.stringify(option)
		);
	assert.equal(fit(bars([60, 70], { beginAtZero: false }, { dataset: { hidden: false } })), `? unmodelled ${ASKED}`);
	assert.equal(fit(bars([60, 70], { beginAtZero: false, stacked: true })), `? unmodelled ${ASKED}`);
	assert.equal(
		fit(bars([60, 70], { beginAtZero: false }, { more: [{ type: 'scatter', data: [{ x: 1, y: 2 }] }] })),
		`? unmodelled ${ASKED}`
	);
	// Floating bars are not read; no values at all fit nothing.
	assert.equal(fit(bars([[60, 70]], { beginAtZero: false })), `? unmodelled ${ASKED}`);
	assert.equal(fit(bars([], { beginAtZero: false })), `? unmodelled ${ASKED}`);
	const getter = Object.defineProperty({}, 'beginAtZero', { get: () => false, enumerable: true });
	assert.equal(fit(bars([60, 70], getter)), `? accessor ${ASKED}`);
	// A configured minimum is reported by itself; the fit is not modelled with it.
	assert.deepEqual(baselines(bars([60, 70], { beginAtZero: false, min: 10 })), ['$.options.scales.y.min']);
});

test('base: a bar grows from its base, through the dataset, options.datasets.bar and the options; zero by default', () => {
	const bases = (config) => normalize(config).series.items.map(({ base }) => brief(base));
	assert.deepEqual(bases(bars([60])), ['0 default $.data.datasets[0].base']);
	assert.deepEqual(bases(bars([60], {}, { dataset: { base: 20 } })), ['20 config $.data.datasets[0].base']);
	assert.deepEqual(baselines(bars([60], {}, { dataset: { base: 20 } })), ['$.data.datasets[0].base']);
	assert.deepEqual(bases(bars([60], {}, { options: { datasets: { bar: { base: 5 } }, base: 3 } })), [
		'5 config $.options.datasets.bar.base'
	]);
	assert.deepEqual(bases(bars([60], {}, { options: { base: 3 } })), ['3 config $.options.base']);
	assert.deepEqual(bases(bars([60], {}, { dataset: { base: () => 1 }, more: [{ type: 'line', data: [1] }] })), [
		'? dynamic $.data.datasets[0].base',
		'? inapplicable $.data.datasets[1].base'
	]);
	assert.deepEqual(baselines(bars([60], {}, { dataset: { base: 0 } })), []);
	// On a logarithmic axis bar-log-scale reports instead.
	assert.deepEqual(baselines(bars([60], { type: 'logarithmic' }, { dataset: { base: 20 } })), []);
});

test('unit: plain numbers on a linear scale unless a tick callback formats them', () => {
	const unit = (config, key = 'y') => brief(normalize(config).axes.find((axis) => axis.key === key).unit);
	assert.equal(unit(bars([1])), ' default $.options.scales.y.ticks.callback');
	assert.equal(
		unit(bars([1], { ticks: { callback: (value) => `${String(value)}%` } })),
		'? dynamic $.options.scales.y.ticks.callback'
	);
	assert.equal(unit(bars([1]), 'x'), '? unmodelled $.options.scales.x.ticks.callback');
});
