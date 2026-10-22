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

test('longest: the option or a series duration (default 1000 ms); none with animation off; functions are dynamic', () => {
	assert.deepEqual(motion({ series: [{ type: 'bar' }] })[1], '1000 default $.animationDuration');
	assert.deepEqual(
		motion({ animationDuration: 2000, series: [{ type: 'bar', animationDuration: 7000 }] })[1],
		'7000 config $.series[0].animationDuration'
	);
	assert.deepEqual(
		motion({ animation: false, series: [{ type: 'bar', animationDuration: 7000 }] })[1],
		'0 config $.animation'
	);
	assert.deepEqual(motion({ animationDuration: () => 1, series: [] })[1], '? dynamic $.animationDuration');
});
