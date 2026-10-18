import assert from 'node:assert/strict';
import test from 'node:test';

import { s, validateConfig } from '../dist/index.js';

const manifest = (root, coverage = 'partial') => ({ library: 'test', version: '1', coverage, source: 'test', root });
const run = (root, value) => validateConfig(value, manifest(root));
const codes = (root, value) => run(root, value).diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`);

const scriptableNumber = { kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'function' }] };
const size = { kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'string' }, { kind: 'null' }] };

test('unions dispatch on the runtime kind of the value', () => {
	assert.deepEqual(codes(scriptableNumber, 3), []);
	assert.deepEqual(
		codes(scriptableNumber, () => 3),
		[]
	);
	assert.deepEqual(codes(size, null), []);
	assert.deepEqual(codes(size, '50%'), []);
});

test('a value matching no member kind is a confirmed type error', () => {
	const result = run(size, true);
	assert.equal(result.status, 'invalid');
	assert.equal(result.diagnostics[0].message, 'Expected number | string | null, got boolean.');
});

test('same-kind primitive members merge their enums or widen', () => {
	const position = { kind: 'union', anyOf: [s.string(['top', 'bottom']), s.string(['left'])] };
	assert.deepEqual(codes(position, 'left'), []);
	assert.deepEqual(codes(position, 'middle'), ['CFG_ENUM error $']);
	const open = { kind: 'union', anyOf: [s.string(['top']), s.string()] };
	assert.deepEqual(codes(open, 'middle'), []);
});

test('same-kind array members merge their element schemas', () => {
	const arrays = { kind: 'union', anyOf: [s.array(s.number()), s.array(s.string())] };
	assert.deepEqual(codes(arrays, [1, 'a']), []);
	assert.deepEqual(codes(arrays, [true]), ['CFG_TYPE error $[0]']);
});

const linear = s.object({ type: s.string(['linear']), min: s.number() }, 'warn');
const time = s.object({ type: s.string(['time']), min: { kind: 'union', anyOf: [s.number(), s.string()] } }, 'warn');
const scale = (extra = {}) => ({ kind: 'union', anyOf: [linear, time], discriminator: 'type', ...extra });

test('discriminated object unions validate the selected variant', () => {
	assert.deepEqual(codes(scale(), { type: 'time', min: '2024-01-01' }), []);
	assert.deepEqual(codes(scale(), { type: 'linear', min: '50' }), ['CFG_TYPE error $.min']);
});

test('an absent discriminator is inconclusive unless a default variant exists', () => {
	const ambiguous = run(scale(), { min: '50' });
	assert.equal(ambiguous.valid, true);
	assert.equal(ambiguous.status, 'partial');
	assert.deepEqual(codes(scale(), { min: '50' }), ['CFG_AMBIGUOUS info $']);
	assert.deepEqual(codes(scale({ defaultVariant: 0 }), { min: '50' }), ['CFG_TYPE error $.min']);
	assert.deepEqual(codes(scale({ defaultVariant: 0 }), { type: undefined, min: 1 }), []);
});

test('unknown discriminator values are errors only for closed registries', () => {
	assert.deepEqual(codes(scale(), { type: 'lineer' }), ['CFG_ENUM error $.type']);
	const result = run(scale({ extensible: true }), { type: 'lineer' });
	assert.equal(result.valid, true);
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.severity, d.suggestion]),
		[['CFG_UNKNOWN_VARIANT', 'warning', 'Did you mean "linear"?']]
	);
	assert.deepEqual(codes(scale({ extensible: true }), { type: 7 }), ['CFG_UNKNOWN_VARIANT warning $.type']);
});

test('object unions without a discriminator are inconclusive', () =>
	assert.deepEqual(codes({ kind: 'union', anyOf: [linear, time] }, { min: 1 }), ['CFG_AMBIGUOUS info $']));

test('an any member accepts everything', () =>
	assert.deepEqual(codes({ kind: 'union', anyOf: [s.number(), s.any()] }, { x: 1 }), []));

test('record values validate every caller-chosen key', () => {
	const scales = { kind: 'object', properties: {}, values: scale(), additionalProperties: 'allow' };
	assert.deepEqual(codes(scales, { x: { type: 'linear', min: 0 }, y1: { type: 'linear', min: 'a' } }), [
		'CFG_TYPE error $.y1.min'
	]);
});

test('undefined property values count as absent', () =>
	assert.deepEqual(codes(s.object({ min: s.number() }), { min: undefined }), []));
