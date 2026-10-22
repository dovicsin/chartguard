import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const motion = (options, dataset = {}) => {
	const { endless, longest } = normalize({
		type: 'line',
		data: { datasets: [{ data: [1], ...dataset }] },
		options
	}).motion;
	return [brief(endless), brief(longest)];
};

test('defaults, loops and durations of options.animation and options.animations', () => {
	assert.deepEqual(motion({}), ['false default $.options.animation.loop', '1000 default $.options.animation.duration']);
	assert.deepEqual(motion({ animation: { loop: true, duration: 6000 } }), [
		'true config $.options.animation.loop',
		'6000 config $.options.animation.duration'
	]);
	assert.deepEqual(motion({ animations: { y: { loop: true, duration: 7000 } } }), [
		'true config $.options.animations.y.loop',
		'7000 config $.options.animations.y.duration'
	]);
	assert.deepEqual(motion({ animation: false }), ['false config $.options.animation', '0 config $.options.animation']);
});

test('functions, getters and dataset animation options are not modelled', () => {
	assert.deepEqual(motion({ animation: { duration: () => 1 } })[1], '? dynamic $.options.animation.duration');
	assert.deepEqual(motion({ animation: { loop: () => true } })[0], '? dynamic $.options.animation.loop');
	assert.deepEqual(motion({}, { animation: { duration: 9000 } }), [
		'? unmodelled $.options.animation',
		'? unmodelled $.options.animation'
	]);
	assert.deepEqual(motion(Object.defineProperty({}, 'animation', { get: () => false })), [
		'? unmodelled $.options.animation',
		'? unmodelled $.options.animation'
	]);
});
