import assert from 'node:assert/strict';
import test from 'node:test';

import { asNumber, asString, readPath, review } from '../dist/index.js';
test('bar charts can warn about baseline', () =>
	assert.ok(review({ kind: 'bar', yMin: 60 }, 'test').diagnostics.some((d) => d.code === 'VIS_BAR_BASELINE')));

test('zero baseline and other chart kinds stay quiet', () => {
	assert.deepEqual(review({ kind: 'bar', yMin: 0 }, 'test').diagnostics, []);
	assert.deepEqual(review({ kind: 'line', yMin: 60 }, 'test').diagnostics, []);
});

test('empty title is informational', () => {
	const [diagnostic] = review({ title: '  ' }, 'test').diagnostics;
	assert.equal(diagnostic.code, 'VIS_EMPTY_TITLE');
	assert.equal(diagnostic.severity, 'info');
});

test('quality findings never make a result invalid', () =>
	assert.equal(review({ kind: 'bar', yMin: 5 }, 'x').valid, true));

test('path reads skip getters and wrong types', () => {
	const config = { a: [{ b: 1 }] };
	Object.defineProperty(config, 'hidden', { get: () => ({ b: 2 }) });
	assert.equal(readPath(config, ['a', 0, 'b']), 1);
	assert.equal(readPath(config, ['hidden', 'b']), undefined);
	assert.equal(readPath(config, ['a', 0, 'b', 'c']), undefined);
	assert.equal(asNumber('1'), undefined);
	assert.equal(asString(1), undefined);
});
