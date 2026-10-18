import assert from 'node:assert/strict';
import test from 'node:test';

import { locate, parseJson, pathSegments } from '../dist/locate.js';

const text = '{\n  "type": "bar",\n  "data": { "datasets": [ { "data": [1, 2] }, {"label": "x"} ] }\n}';
const parsed = parseJson(text);
const slice = (span) => text.slice(span.start, span.end);

test('valid JSON parses with a span for every value', () => {
	assert.equal(parsed.ok, true);
	assert.equal(slice(parsed.root), text);
	assert.equal(slice(locate(parsed.root, '$.type')), '"bar"');
	assert.equal(slice(locate(parsed.root, '$.data.datasets[0].data[1]')), '2');
	assert.equal(slice(locate(parsed.root, '$.data.datasets[1]')), '{"label": "x"}');
});

test('a path that does not exist resolves to its deepest existing ancestor, marked inexact', () => {
	const missing = locate(parsed.root, '$.data.datasets[1].data');
	assert.equal(missing.exact, false);
	assert.equal(slice(missing), '{"label": "x"}');
	assert.equal(locate(parsed.root, '$.type.inner').exact, false);
	assert.equal(locate(parsed.root, '$').exact, true);
});

test('path segments: keys, indices and hole ranges', () => {
	assert.deepEqual(pathSegments('$.a[0].b'), ['a', 0, 'b']);
	assert.deepEqual(pathSegments('$.series[3..9]'), ['series', 3]);
	assert.deepEqual(pathSegments('$'), []);
});

test('syntax errors are reported with the offset where reading stopped', () => {
	const cases = [
		['{"a": 1,}', 'Expected a JSON value', 8],
		['{"a" 1}', 'Expected ":"', 5],
		['{a: 1}', 'Expected a JSON value', 1],
		['{1: 2}', 'Expected a property name in double quotes', 1],
		['[1, 2', 'Expected "]"', 5],
		['{} x', 'Unexpected text after the JSON value', 3],
		["{'a': 1}", 'Expected a JSON value', 1]
	];
	for (const [input, message, offset] of cases) assert.deepEqual(parseJson(input), { ok: false, message, offset }, input);
});

test('the reader accepts exactly what JSON.parse accepts on common inputs', () => {
	for (const input of ['[]', '{}', '"x"', '-0.5e+3', 'true', 'null', '[{"a":[{}]}]', ' { "k\\"ey" : "v\\u0041" } '])
		assert.equal(parseJson(input).ok, true, input);
	for (const input of ['', '01', '[1,]', '"a', 'tru', '+1', '"tab\there"']) {
		assert.equal(parseJson(input).ok, false, input);
		assert.throws(() => JSON.parse(input), SyntaxError, input);
	}
});
