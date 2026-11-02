import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const motion = (option) => {
	const { endless, longest } = normalize(option).motion;
	return [brief(endless), brief(longest)];
};

test('endless: an effectScatter rippling on render (its default), a lines effect looping (its default)', () => {
	assert.deepEqual(motion({ series: [{ type: 'bar' }] })[0], 'false config $.series');
	assert.deepEqual(motion({ series: [{ type: 'effectScatter' }] })[0], 'true default $.series[0].showEffectOn');
	assert.deepEqual(
		motion({ series: [{ type: 'effectScatter', showEffectOn: 'emphasis' }] })[0],
		'false config $.series'
	);
	assert.deepEqual(
		motion({ series: [{ type: 'lines', effect: { show: true } }] })[0],
		'true default $.series[0].effect.loop'
	);
	assert.deepEqual(
		motion({ series: [{ type: 'lines', effect: { show: true, loop: false } }] })[0],
		'false config $.series'
	);
	assert.deepEqual(
		motion({ series: [Object.defineProperty({}, 'type', { get: () => 'bar' })] })[0],
		'? accessor $.series[0]'
	);
});

test('longest: each animated series duration, its own or the option (default 1000 ms); functions are dynamic', () => {
	assert.deepEqual(motion({ series: [{ type: 'bar' }] })[1], '1000 default $.series[0].animationDuration');
	assert.deepEqual(motion({ series: [] })[1], '0 config $.series');
	assert.deepEqual(
		motion({ animationDuration: 2000, series: [{ type: 'bar', animationDuration: 7000 }] })[1],
		'7000 config $.series[0].animationDuration'
	);
	assert.deepEqual(
		motion({ animationDuration: 7000, series: [{ type: 'bar' }] })[1],
		'7000 config $.animationDuration'
	);
	assert.deepEqual(
		motion({ animationDuration: () => 1, series: [{ type: 'bar' }] })[1],
		'? dynamic $.animationDuration'
	);
});

const bars = (count, extra = {}) => ({ type: 'bar', data: Array.from({ length: count }, () => 1), ...extra });

test('longest: a series animates as SeriesModel#isAnimationEnabled decides (its animation, else the option; off above animationThreshold)', () => {
	// Off for the series, or for the option and not turned on by the series (`getShallow`: null falls through).
	assert.deepEqual(
		motion({ series: [bars(1, { animation: false, animationDuration: 6000 })] })[1],
		'0 config $.series'
	);
	assert.deepEqual(
		motion({ animation: false, series: [bars(1, { animationDuration: 7000 })] })[1],
		'0 config $.series'
	);
	assert.deepEqual(
		motion({ animation: false, series: [bars(1, { animation: null, animationDuration: 7000 })] })[1],
		'0 config $.series'
	);
	assert.deepEqual(
		motion({ animation: false, series: [bars(1, { animation: true, animationDuration: 7000 })] })[1],
		'7000 config $.series[0].animationDuration'
	);
	// More data than the threshold (2000 by default, the series' or the option's): no animation.
	assert.deepEqual(motion({ series: [bars(2500, { animationDuration: 6000 })] })[1], '0 config $.series');
	assert.deepEqual(
		motion({ series: [bars(2000, { animationDuration: 6000 })] })[1],
		'6000 config $.series[0].animationDuration'
	);
	assert.deepEqual(
		motion({ animationThreshold: 3000, series: [bars(2500, { animationDuration: 6000 })] })[1],
		'6000 config $.series[0].animationDuration'
	);
	assert.deepEqual(
		motion({ series: [bars(20, { animationThreshold: 10, animationDuration: 6000 })] })[1],
		'0 config $.series'
	);
});

test('longest: a series whose animation or data count is not known leaves it unknown when it could be the longest', () => {
	const hiddenAnimation = Object.defineProperty(bars(1, { animationDuration: 6000 }), 'animation', {
		get: () => false,
		enumerable: true
	});
	assert.deepEqual(motion({ series: [hiddenAnimation] })[1], '? accessor $.series[0].animation');
	// A count from a dataset, or of a hierarchy, is not read.
	assert.deepEqual(
		motion({ dataset: { source: [[1]] }, series: [{ type: 'bar', animationDuration: 6000 }] })[1],
		'? unmodelled $.series[0].data'
	);
	assert.deepEqual(
		motion({ series: [{ type: 'treemap', data: [{ value: 1 }], animationDuration: 6000 }] })[1],
		'? unmodelled $.series[0].data'
	);
	assert.deepEqual(
		motion({ series: [bars(1, { animationThreshold: '10', animationDuration: 6000 })] })[1],
		'? shape $.series[0].animationThreshold'
	);
	assert.deepEqual(
		motion({ series: [bars(1, { large: true, animationDuration: 6000 })] })[1],
		'? unmodelled $.series[0].large'
	);
	// It does not matter when a series known to animate lasts longer.
	assert.deepEqual(
		motion({ series: [hiddenAnimation, bars(1, { animationDuration: 7000 })] })[1],
		'7000 config $.series[1].animationDuration'
	);
	assert.deepEqual(
		motion({ dataset: { source: [[1]] }, series: [{ type: 'bar' }] })[1],
		'? unmodelled $.series[0].data'
	);
});
