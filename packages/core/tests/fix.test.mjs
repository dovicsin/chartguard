import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFix, FixError } from '../dist/index.js';

/** `applyFix` (CG-05-06): an edit applied to a copy, never to the input, never running a getter. */
const set = (path, value, from) => ({
	kind: 'set-option',
	path,
	value,
	effect: 'e',
	...(from === undefined ? {} : { from })
});

test('set-option: replaces the value it was made for, or sets one where none was; objects on the way are created', () => {
	const config = { options: { scales: { y: { min: 50, max: 90 } } }, data: { datasets: [{ data: [1] }] } };
	const after = applyFix(config, set('$.options.scales.y.min', 0, 50));
	assert.deepEqual(after, { options: { scales: { y: { min: 0, max: 90 } } }, data: { datasets: [{ data: [1] }] } });
	// The input is untouched; only the objects on the path are new, the rest is shared.
	assert.equal(config.options.scales.y.min, 50);
	assert.notEqual(after.options, config.options);
	assert.equal(after.data, config.data);
	assert.deepEqual(applyFix({}, set('$.aria.label.enabled', true)), { aria: { label: { enabled: true } } });
	assert.deepEqual(applyFix({ series: [{}, { data: [] }] }, set('$.series[1].threshold', 0)), {
		series: [{}, { data: [], threshold: 0 }]
	});
	assert.deepEqual(applyFix({ yAxis: { 'a b': {} } }, set('$.yAxis["a b"].x', null)), {
		yAxis: { 'a b': { x: null } }
	});
	// `null` is a value: it must be what is there.
	assert.deepEqual(applyFix({ title: { text: null } }, set('$.title.text', 'T', null)), { title: { text: 'T' } });
});

test('set-option refuses once the option is not what the finding saw', () => {
	const refuse = (config, fix, message) =>
		assert.throws(
			() => applyFix(config, fix),
			(error) => error instanceof FixError && message.test(error.message)
		);
	refuse({ y: { min: 40 } }, set('$.y.min', 0, 50), /no longer 50/);
	refuse({ y: {} }, set('$.y.min', 0, 50), /no longer 50/);
	refuse({ y: { min: 50 } }, set('$.y.min', 0), /no longer unset/);
	refuse({ y: { min: '50' } }, set('$.y.min', 0, 50), /no longer 50/);
	refuse({ series: [] }, set('$.series[0].threshold', 0), /no element 0/);
	refuse({ y: 5 }, set('$.y.min', 0), /number on the way/);
	refuse({}, set('options.y', 0), /not a path/);
	refuse({}, set('$', 0), /not a path/);
});

test('getters are copied, never run; a getter on the path refuses the edit', () => {
	let runs = 0;
	const getter = () => {
		runs += 1;
		return 1;
	};
	const config = { y: Object.defineProperty({ min: 50 }, 'max', { get: getter, enumerable: true }) };
	const after = applyFix(config, set('$.y.min', 0, 50));
	assert.equal(runs, 0);
	assert.equal(typeof Object.getOwnPropertyDescriptor(after.y, 'max').get, 'function');
	assert.equal(runs, 0);
	const hidden = Object.defineProperty({}, 'y', { get: getter, enumerable: true });
	assert.throws(() => applyFix(hidden, set('$.y.min', 0)), FixError);
	assert.throws(
		() => applyFix({ y: Object.defineProperty({}, 'min', { get: getter }) }, set('$.y.min', 0, 1)),
		/getter/
	);
	assert.equal(runs, 0);
});

test('frozen inputs stay frozen and are copied; prototypes and array holes are kept', () => {
	const frozen = Object.freeze({ y: Object.freeze({ min: 50 }) });
	assert.deepEqual(applyFix(frozen, set('$.y.min', 0, 50)), { y: { min: 0 } });
	assert.equal(frozen.y.min, 50);
	class Options {
		min = 50;
	}
	const instance = applyFix({ y: new Options() }, set('$.y.min', 0, 50)).y;
	assert.ok(instance instanceof Options);
	const sparse = Array.from({ length: 3 });
	Object.assign(sparse, { 0: 1, 2: 3 });
	Reflect.deleteProperty(sparse, '1');
	const array = applyFix({ a: sparse }, set('$.a[0]', 0, 1)).a;
	assert.deepEqual([array.length, 1 in array], [3, false]);
});

test('rename-key: moves the value to the new name while it is free; needs the path of the key', () => {
	const fix = { kind: 'rename-key', to: 'newName' };
	assert.deepEqual(applyFix({ a: { oldName: 5, other: 1 } }, fix, '$.a.oldName'), { a: { other: 1, newName: 5 } });
	assert.throws(() => applyFix({ a: { oldName: 5, newName: 6 } }, fix, '$.a.oldName'), /already set/);
	assert.deepEqual(applyFix({ a: { oldName: 5, newName: undefined } }, fix, '$.a.oldName'), { a: { newName: 5 } });
	assert.throws(() => applyFix({ a: { oldName: null } }, fix, '$.a.oldName'), /nothing to rename/);
	assert.throws(() => applyFix({ a: {} }, fix, '$.a.oldName'), /nothing to rename/);
	assert.throws(() => applyFix({ a: { oldName: 5 } }, fix), /needs the path/);
});
