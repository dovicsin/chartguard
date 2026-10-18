import assert from 'node:assert/strict';
import test from 'node:test';

import { formatPath, numberAt, readPath, review, stringAt } from '../dist/index.js';

const fact = (value, path) => ({ value, path });

test('bar charts can warn about baseline at the path the fact was read from', () => {
	const [diagnostic] = review(
		{ kind: fact('bar', '$.type'), yMin: fact(60, '$.options.scales.y.min') },
		't'
	).diagnostics;
	assert.equal(diagnostic.code, 'VIS_BAR_BASELINE');
	assert.equal(diagnostic.path, '$.options.scales.y.min');
});

test('zero baseline, unknown facts and other chart kinds stay quiet', () => {
	assert.deepEqual(review({ kind: fact('bar', '$.type'), yMin: fact(0, '$.y') }, 't').diagnostics, []);
	assert.deepEqual(review({ kind: fact('line', '$.type'), yMin: fact(60, '$.y') }, 't').diagnostics, []);
	assert.deepEqual(review({ kind: fact('bar', '$.type') }, 't').diagnostics, []);
	assert.deepEqual(review({}, 't').diagnostics, []);
});

test('empty title is informational and points at the title', () => {
	const [diagnostic] = review({ title: fact('  ', '$.title.text') }, 't').diagnostics;
	assert.equal(diagnostic.code, 'VIS_EMPTY_TITLE');
	assert.equal(diagnostic.severity, 'info');
	assert.equal(diagnostic.path, '$.title.text');
	assert.deepEqual(review({ title: fact('Sales', '$.title.text') }, 't').diagnostics, []);
});

test('a report is advisory: it names its rules version and carries no verdict', () => {
	const report = review({ kind: fact('bar', '$.type'), yMin: fact(5, '$.y') }, 'x');
	assert.deepEqual(Object.keys(report).sort(), ['diagnostics', 'library', 'rulesVersion']);
	assert.equal(report.library, 'x');
	assert.ok(report.diagnostics.every((diagnostic) => diagnostic.severity !== 'error'));
});

test('path reads skip getters and wrong types', () => {
	const config = { a: [{ b: 1 }] };
	Object.defineProperty(config, 'hidden', { get: () => ({ b: 2 }) });
	assert.equal(readPath(config, ['a', 0, 'b']), 1);
	assert.equal(readPath(config, ['hidden', 'b']), undefined);
	assert.equal(readPath(config, ['a', 0, 'b', 'c']), undefined);
	assert.equal(numberAt({ n: '1' }, ['n']), undefined);
	assert.equal(stringAt({ s: 1 }, ['s']), undefined);
});

test('facts remember where they were read from, in the engine path syntax', () => {
	assert.deepEqual(stringAt({ series: [{ type: 'bar' }] }, ['series', 0, 'type']), {
		value: 'bar',
		path: '$.series[0].type'
	});
	assert.equal(formatPath([]), '$');
	assert.equal(formatPath(['a', 1, 'b']), '$.a[1].b');
});
