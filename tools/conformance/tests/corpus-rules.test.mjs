import assert from 'node:assert/strict';
import test from 'node:test';

import { copyPlain } from '../lib/copy.mjs';
import { allowedExplanations, isClean } from '../lib/corpus.mjs';
import { createUtils } from '../sandbox/chartjs-utils.mjs';

const ran = (findings, runtime) => ({ status: 'ran', findings, runtime, messages: [] });

test('clean means rendered silently with no warning or error finding', () => {
	assert.equal(isClean(ran([], 'accepted')), true);
	assert.equal(isClean(ran(['info CFG_AMBIGUOUS $.a'], 'accepted')), true);
	assert.equal(isClean(ran(['warning CFG_UNKNOWN_KEY $.a'], 'accepted')), false);
	assert.equal(isClean(ran([], 'complained')), false);
	assert.equal(isClean({ status: 'no-config' }), false);
});

test('allowed explanations follow the contract rule, plus environment and out-of-scope for runtime-only signals', () => {
	assert.deepEqual(allowedExplanations({ status: 'example-threw' }), ['Environment:']);
	assert.deepEqual(allowedExplanations(ran([], 'accepted')), []);
	assert.deepEqual(allowedExplanations(ran(['error CFG_TYPE $.a'], 'accepted')), ['Type contract:']);
	assert.deepEqual(allowedExplanations(ran(['warning CFG_UNKNOWN_KEY $.a'], 'rejected')), ['Unresolved:']);
	assert.deepEqual(allowedExplanations(ran([], 'complained')), ['False negative (CG-', 'Environment:', 'Out of scope:']);
});

test('sandbox objects are rebuilt in this realm; functions, dates, typed arrays and cycles survive', () => {
	const kept = { fn: () => 1, date: new Date(0), typed: new Float32Array([1]) };
	const list = [1, 2, 3];
	delete list[1];
	const source = Object.assign(Object.create(null), { list, nested: { ...kept } });
	source.self = source;
	const copy = copyPlain(source);
	assert.equal(Object.getPrototypeOf(copy), Object.prototype);
	assert.equal(copy.nested.constructor, Object);
	assert.equal(copy.self, copy);
	assert.deepEqual([copy.list.length, 1 in copy.list], [3, false]);
	assert.deepEqual(copy.nested, kept);
	for (const key of Object.keys(kept)) assert.equal(copy.nested[key], kept[key]);
});

test('the docs Utils stand-in is deterministic', () => {
	const first = createUtils();
	const second = createUtils();
	assert.deepEqual(first.numbers({ count: 3 }), second.numbers({ count: 3 }));
	first.srand(1);
	second.srand(1);
	assert.equal(first.rand(0, 10), second.rand(0, 10));
});

test('the docs Utils stand-in keeps the documented shapes', () => {
	const first = createUtils();
	assert.deepEqual(first.months({ count: 2, section: 3 }), ['Jan', 'Feb']);
	assert.equal(first.transparentize('rgb(255, 99, 132)', 0.5), 'rgba(255, 99, 132, 0.5)');
	assert.equal(first.transparentize('#4dc9f6'), 'rgba(77, 201, 246, 0.5)');
	assert.equal(first.parseISODate('2024-01-02T00:00:00Z').toMillis(), Date.UTC(2024, 0, 2));
	assert.equal(first.newDateString(1), '2024-01-02T00:00:00.000Z');
	assert.equal(first.points({ count: 2 }).length, 2);
	assert.equal(first.bubbles({ count: 1, rmin: 1, rmax: 2 })[0].r >= 1, true);
	assert.deepEqual(first.labels({ min: 0, max: 2, count: 2, prefix: 'v' }), ['v0', 'v1']);
	assert.equal(first.color(10), first.color(1));
	assert.equal(first.namedColor(7), first.namedColor(0));
});
