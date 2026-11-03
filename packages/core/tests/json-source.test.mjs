import assert from 'node:assert/strict';
import test from 'node:test';

import { locateJsonKey as locateKey, locateJsonPath as locate, parseJsonSource as parseJson } from '../dist/index.js';

const text = '{\n  "type": "bar",\n  "data": { "datasets": [ { "data": [1, 2] }, {"label": "x"} ] }\n}';
const parsed = parseJson(text);
const slice = (span) => text.slice(span.start, span.end);
const slice2 = (source, span) => source.slice(span.start, span.end);

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

test('paths: keys, indices, hole ranges and quoted keys reach one place each', () => {
	const { root } = parseJson('{"title": {"te.xt": 1, "te": {"xt": 2}}, "series": [0, 1, 2, 3, 4]}');
	assert.equal(locate(root, '$.title["te.xt"]').exact, true);
	assert.equal(
		slice2('{"title": {"te.xt": 1, "te": {"xt": 2}}, "series": [0, 1, 2, 3, 4]}', locate(root, '$.title.te.xt')),
		'2'
	);
	// A run of holes (`$.a[3..9]`, one finding for a sparse list) points at its first entry.
	assert.equal(locate(root, '$.series[3..4]').exact, true);
	// A path that is not one the engine writes points at the root, inexact, never a thrown error.
	assert.deepEqual(locate(root, '$["\\x"]'), {
		start: 0,
		end: root.end,
		exact: false,
		line: 1,
		column: 1,
		endLine: 1,
		endColumn: root.end + 1
	});
});

test('a span carries its line and column (1-based), for editors and SARIF', () => {
	const json = '{\n  "a": [1,\n    true]\n}';
	const { root } = parseJson(json);
	assert.deepEqual(locate(root, '$.a[1]'), {
		start: 17,
		end: 21,
		exact: true,
		line: 3,
		column: 5,
		endLine: 3,
		endColumn: 9
	});
	assert.deepEqual(parseJson('{\n  x}'), {
		ok: false,
		message: 'Expected a JSON value',
		offset: 4,
		line: 2,
		column: 3
	});
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
	for (const [input, message, offset] of cases) {
		const { ok, message: said, offset: at } = parseJson(input);
		assert.deepEqual({ ok, message: said, offset: at }, { ok: false, message, offset }, input);
	}
});

test('the reader accepts exactly what JSON.parse accepts on common inputs', () => {
	for (const input of ['[]', '{}', '"x"', '-0.5e+3', 'true', 'null', '[{"a":[{}]}]', ' { "k\\"ey" : "v\\u0041" } '])
		assert.equal(parseJson(input).ok, true, input);
	for (const input of ['', '01', '[1,]', '"a', 'tru', '+1', '"tab\there"']) {
		assert.equal(parseJson(input).ok, false, input);
		assert.throws(() => JSON.parse(input), SyntaxError, input);
	}
});

test('whitespace and escapes JSON does not accept are syntax errors, never a thrown exception (H13)', () => {
	// JSON whitespace is space, tab, line feed and carriage return only.
	for (const space of ['\u00a0', '\ufeff', '\u2028', '\u2029', '\u000b', '\u000c', '\u3000']) {
		const input = `{${space}"a": 1}`;
		assert.throws(() => JSON.parse(input), SyntaxError, JSON.stringify(input));
		const result = parseJson(input);
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.equal(result.offset, 1);
	}
	// An escape JSON does not know, in a key or a value.
	for (const input of ['{"\\x": 1}', '{"a": "\\x"}', '["\\u12"]', '["\\\'"]']) {
		assert.throws(() => JSON.parse(input), SyntaxError, input);
		assert.equal(parseJson(input).ok, false, input);
	}
	for (const input of ['{ "\\/\\b\\f\\n\\r\\t\\u00e9": 1 }', ' \t\r\n[1]\n'])
		assert.equal(parseJson(input).ok, true, input);
});

test('the key token of each entry of an object; a duplicate key the last one, as JSON.parse keeps its value', () => {
	const source = '{ "a": 1, "b\\u0022c": {"d": [] }, "a": 2 }';
	const { root } = parseJson(source);
	assert.equal(slice2(source, locateKey(root, 'b"c')), '"b\\u0022c"');
	assert.equal(locateKey(root, 'a').start, source.lastIndexOf('"a"'));
	assert.equal(locateKey(root, 'a').column, source.lastIndexOf('"a"') + 1);
	assert.equal(slice2(source, root.entries.get('a')), '2');
	assert.equal(slice2(source, locateKey(root.entries.get('b"c'), 'd')), '"d"');
	assert.equal(locateKey(root, 'd'), undefined);
	assert.equal(locateKey(root.entries.get('a'), 'a'), undefined);
	// A node built by hand, not read by parseJsonSource, has no key tokens to report.
	assert.equal(locateKey({ ...root }, 'a'), undefined);
});
