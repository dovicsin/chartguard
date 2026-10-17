import assert from 'node:assert/strict';
import test from 'node:test';

import { s, validateConfig } from '../dist/index.js';
const manifest = {
	library: 'test',
	version: '1',
	coverage: 'partial',
	source: 'test',
	root: s.object({ foo: s.number() })
};
test('unknown keys are NOT falsely treated as invalid in partial schemas', () => {
	const r = validateConfig({ foo: 2, bar: true }, manifest);
	assert.equal(r.valid, true);
	assert.equal(r.status, 'partial');
	assert.equal(r.diagnostics[0].code, 'CFG_UNKNOWN_KEY');
});
test('known field type error', () =>
	assert.equal(validateConfig({ foo: 'no' }, manifest).diagnostics[0].code, 'CFG_TYPE'));

test('cyclic nested configs never recurse indefinitely', () => {
	const obj = {};
	obj.self = obj;
	const cyclicManifest = {
		library: 'test',
		version: '1',
		coverage: 'partial',
		source: 'test',
		root: s.object({ self: s.object({ self: s.any() }) })
	};
	const out = validateConfig(obj, cyclicManifest);
	assert.ok(out.diagnostics.some((x) => x.code === 'CFG_CYCLE'));
});
test('getter is never invoked by runtime validator', () => {
	let called = 0;
	const obj = {};
	Object.defineProperty(obj, 'foo', {
		enumerable: true,
		get() {
			called++;
			throw Error('BAD');
		}
	});
	const out = validateConfig(obj, manifest);
	assert.equal(called, 0);
	assert.ok(out.diagnostics.some((x) => x.code === 'CFG_DYNAMIC'));
});

const strict = {
	library: 'test',
	version: '1',
	coverage: 'full',
	source: 'test',
	root: s.object(
		{ kind: s.string(['bar', 'line']), points: s.array(s.number()), legend: s.object({}, 'allow') },
		'deny',
		['kind']
	)
};

test('unknown keys are errors only for full, closed schemas', () => {
	const out = validateConfig({ kind: 'bar', knd: 1 }, strict);
	assert.equal(out.status, 'invalid');
	assert.deepEqual(
		out.diagnostics.map((d) => [d.code, d.severity, d.suggestion]),
		[['CFG_UNKNOWN_KEY', 'error', 'Did you mean "kind"?']]
	);
});

test('a complete, clean config against a full schema is valid', () => {
	assert.equal(validateConfig({ kind: 'line', points: [1, 2], legend: { anything: true } }, strict).status, 'valid');
});

test('enum, required and array element violations are confirmed errors', () => {
	const codes = (input) => validateConfig(input, strict).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ kind: 'pie' }), ['CFG_ENUM $.kind']);
	assert.deepEqual(codes({}), ['CFG_REQUIRED $.kind']);
	assert.deepEqual(codes({ kind: 'bar', points: [1, 'two'] }), ['CFG_TYPE $.points[1]']);
});

test('array holes are unknown, not errors', () => {
	const points = [1, 2, 3];
	delete points[1];
	const out = validateConfig({ kind: 'bar', points }, strict);
	assert.equal(out.valid, true);
	assert.equal(out.status, 'partial');
	assert.deepEqual(
		out.diagnostics.map((d) => d.code),
		['CFG_DYNAMIC']
	);
});

test('excessive depth stops with an unknown diagnostic', () => {
	let node = {};
	const root = node;
	for (let depth = 0; depth < 45; depth++) node = node.next = {};
	const deep = { library: 'test', version: '1', coverage: 'partial', source: 'test', root: s.object({}) };
	let schema = deep.root;
	for (let depth = 0; depth < 45; depth++) schema = schema.properties.next = s.object({});
	assert.ok(validateConfig(root, deep).diagnostics.some((d) => d.code === 'CFG_DEPTH'));
});
