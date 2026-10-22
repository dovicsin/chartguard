import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../dist/index.js';

/** Chart.js fixes (CG-05-06): each remedy, and where none is offered. */
const fixes = (config, options) =>
	analyze(config, options).diagnostics.map(
		({ code, fix }) =>
			`${code} ${fix === undefined ? '-' : `${fix.path} ${JSON.stringify(fix.from)}→${JSON.stringify(fix.value)}`}`
	);
const bars = (y = {}, options = {}, dataset = {}) => ({
	type: 'bar',
	data: { labels: ['a', 'b'], datasets: [{ label: 'S', data: [60, 70], backgroundColor: '#1f77b4', ...dataset }] },
	options: {
		plugins: { title: { display: true, text: 'T' } },
		scales: { y: { title: { display: true, text: 'U' }, ...y } },
		...options
	}
});

test('bar baseline: a bound or base to 0, beginAtZero back to true', () => {
	assert.deepEqual(fixes(bars({ min: 50 })), ['VIS_BAR_BASELINE $.options.scales.y.min 50→0']);
	assert.deepEqual(fixes(bars({ beginAtZero: false })), ['VIS_BAR_BASELINE $.options.scales.y.beginAtZero false→true']);
	assert.deepEqual(fixes(bars({}, {}, { base: 20 })), ['VIS_BAR_BASELINE $.data.datasets[0].base 20→0']);
	assert.deepEqual(fixes(bars({}, { base: 20 })), ['VIS_BAR_BASELINE $.options.base 20→0']);
	const negative = {
		...bars({ max: -50 }),
		data: { labels: ['a'], datasets: [{ label: 'S', data: [-60], backgroundColor: '#1f77b4' }] }
	};
	assert.deepEqual(fixes(negative), ['VIS_BAR_BASELINE $.options.scales.y.max -50→0']);
});

test('log scale to linear, a reversal off, a loop off, a long duration to one second', () => {
	assert.deepEqual(fixes(bars({ type: 'logarithmic' })), [
		'VIS_BAR_LOG_SCALE $.options.scales.y.type "logarithmic"→"linear"'
	]);
	assert.deepEqual(fixes({ ...bars({ reverse: true }), type: 'line' }), [
		'VIS_REVERSED_VALUE_AXIS $.options.scales.y.reverse true→false'
	]);
	assert.deepEqual(fixes(bars({}, { animation: { loop: true } })), [
		'VIS_LONG_MOTION $.options.animation.loop true→false'
	]);
	assert.deepEqual(fixes(bars({}, { animations: { y: { duration: 9000 } } })), [
		'VIS_LONG_MOTION $.options.animations.y.duration 9000→1000'
	]);
});

test('no fix where the finding needs the author or the page, or where one edit would not resolve it', () => {
	// A canvas is described by the page.
	assert.deepEqual(fixes(bars(), { context: { describesData: false } }), ['VIS_DATA_NOT_DESCRIBED -']);
	assert.deepEqual(fixes(bars({}, { plugins: { title: { display: true, text: '' } } })), ['VIS_EMPTY_TITLE -']);
	// Two long durations: setting one to a second leaves the other, a finding the chart did not have before at that path.
	assert.deepEqual(fixes(bars({}, { animation: { duration: 7000 }, animations: { y: { duration: 9000 } } })), [
		'VIS_LONG_MOTION -'
	]);
	// A minimum and a base both cut the bars: fixing one leaves the other cause reported.
	assert.deepEqual(fixes(bars({ min: 50 }, {}, { base: 20 })), [
		'VIS_BAR_BASELINE $.options.scales.y.min 50→0',
		'VIS_BAR_BASELINE $.data.datasets[0].base 20→0'
	]);
});
