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

const linear = s.object({ type: s.string(['linear']), min: s.number() });
const time = s.object({ type: s.string(['time']), min: s.union([s.number(), s.string()]) });
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

test('nested unions accept exactly what the flattened union accepts', () => {
	const color = s.union([s.string(), s.number()]);
	const scriptableColor = s.union([color, s.func()]);
	assert.deepEqual(codes(scriptableColor, 'red'), []);
	assert.deepEqual(codes(scriptableColor, 7), []);
	assert.deepEqual(
		codes(scriptableColor, () => 'red'),
		[]
	);
	const mismatch = run(scriptableColor, true);
	assert.equal(mismatch.diagnostics[0].message, 'Expected string | number | function, got boolean.');
	assert.deepEqual(codes(s.union([s.union([s.union([s.number()])])]), 1), []);
});

test('a nested discriminated union keeps its discriminator when the outer union has none', () => {
	const scriptableScale = s.union([scale(), s.func()]);
	assert.deepEqual(codes(scriptableScale, { type: 'linear', min: '50' }), ['CFG_TYPE error $.min']);
	assert.deepEqual(codes(scriptableScale, { type: 'time', min: '2024' }), []);
	assert.deepEqual(codes(scriptableScale, { type: 'lineer' }), ['CFG_ENUM error $.type']);
});

test('a single-member extensible union still treats unknown variants as unresolved (A4)', () => {
	const registry = s.union([linear], { discriminator: 'type', extensible: true });
	const result = run(registry, { type: 'realtime' });
	assert.equal(result.valid, true);
	assert.deepEqual(codes(registry, { type: 'realtime' }), ['CFG_UNKNOWN_VARIANT warning $.type']);
	assert.deepEqual(codes(registry, { type: 'linear', min: 'x' }), ['CFG_TYPE error $.min']);
	assert.deepEqual(codes(s.union([linear, s.func()], { discriminator: 'type', extensible: true }), { type: 'other' }), [
		'CFG_UNKNOWN_VARIANT warning $.type'
	]);
});

test('a member whose discriminator is not a literal makes the union inconclusive, never a wrong enum', () => {
	const loose = s.union([s.object({ type: s.string(), a: s.number() }), s.object({ type: s.string(['x']) })], {
		discriminator: 'type'
	});
	assert.deepEqual(codes(loose, { type: 'anything' }), ['CFG_AMBIGUOUS info $']);
});

test('a nested union keeps its default variant when the outer union has none', () => {
	const scriptable = s.union([scale({ defaultVariant: 0 }), s.func()]);
	assert.deepEqual(codes(scriptable, { min: '50' }), ['CFG_TYPE error $.min']);
});

test('an empty union is a programming error, not a schema', () => {
	assert.throws(() => s.union([]), { message: 's.union needs at least one member' });
});

test('consecutive array holes are one finding; a sparse array cannot flood the report', () => {
	const sparse = Object.assign(new Array(30), { 5: 1, 6: 2 });
	assert.deepEqual(codes(s.object({ a: s.array(s.number()) }), { a: sparse }), [
		'CFG_DYNAMIC warning $.a[0..4]',
		'CFG_DYNAMIC warning $.a[7..29]'
	]);
	assert.deepEqual(codes(s.object({ a: s.array(s.number()) }), { a: Object.assign(new Array(2), { 1: 'x' }) }), [
		'CFG_DYNAMIC warning $.a[0]',
		'CFG_TYPE error $.a[1]'
	]);
});

test('incomplete input: a missing required key is unresolved and coverage is partial, other errors stay confirmed', () => {
	const root = s.object({ a: s.number(), b: s.string() }, { required: ['a'], additional: 'deny' });
	const result = validateConfig({ b: 1 }, manifest(root, 'full'), { incomplete: true });
	assert.equal(result.coverage, 'partial');
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.severity} ${d.confidence}`),
		['CFG_REQUIRED warning unknown', 'CFG_TYPE error certain']
	);
	assert.equal(validateConfig({ b: 1 }, manifest(root, 'full')).diagnostics[0].severity, 'error');
});

test('typed arrays are arrays: chart runtimes accept them wherever they take data lists', () => {
	const points = s.object({ data: s.array(s.number()) });
	assert.deepEqual(codes(points, { data: new Float32Array([1, 2]) }), []);
	assert.deepEqual(codes(points, { data: new Uint8Array(0) }), []);
	assert.deepEqual(codes(s.object({ data: s.array(s.string()) }), { data: new Int16Array([1]) }), [
		'CFG_TYPE error $.data[0]'
	]);
	assert.deepEqual(codes(points, { data: new DataView(new ArrayBuffer(2)) }), ['CFG_TYPE error $.data']);
	assert.deepEqual(codes(s.object({ data: s.object({}) }), { data: new Float32Array(1) }), ['CFG_TYPE error $.data']);
});

test('an undefined array element is "not provided", exactly as an undefined property is', () => {
	const rows = s.object({ data: s.array(s.array(s.number())), dimensions: s.array(s.string()) });
	assert.deepEqual(codes(rows, { data: [[1, undefined, 3]], dimensions: [undefined, 'y'] }), []);
	assert.deepEqual(codes(rows, { data: [[1, null]] }), ['CFG_TYPE error $.data[0][1]']);
});

test('conditional defaults: the first rule whose property is truthy picks the variant, else the default variant', () => {
	const category = s.object({ type: s.string(['category']), boundaryGap: s.boolean() });
	const value = s.object({ type: s.string(['value']), min: s.number(), data: s.any() });
	const byData = [{ test: 'truthy', property: 'data', variant: 1 }];
	const axis = s.union([value, category], { discriminator: 'type', defaultVariant: 0, defaultWhen: byData });
	const withData = s.object({ type: s.string(['category']), data: s.array(s.string()), boundaryGap: s.boolean() });
	const axisWithData = s.union([value, withData], { discriminator: 'type', defaultVariant: 0, defaultWhen: byData });
	assert.deepEqual(codes(axisWithData, { data: [], boundaryGap: 'x' }), ['CFG_TYPE error $.boundaryGap']);
	assert.deepEqual(codes(axis, { min: 'x' }), ['CFG_TYPE error $.min']);
	for (const falsy of [0, '', null, false])
		assert.deepEqual(codes(axis, { data: falsy, min: 'x' }), ['CFG_TYPE error $.min']);
	assert.deepEqual(codes(s.union([axisWithData, s.func()]), { data: ['a'], boundaryGap: 'x' }), [
		'CFG_TYPE error $.boundaryGap'
	]);
});

test('a rule whose property is a getter cannot be decided: the variant is ambiguous, never the default (A21)', () => {
	const value = s.object({ type: s.string(['value']), min: s.number(), data: s.any() });
	const category = s.object({ type: s.string(['category']), data: s.any(), categories: s.any() });
	const axis = s.union([value, category], {
		discriminator: 'type',
		defaultVariant: 0,
		defaultWhen: [{ test: 'truthy', property: 'data', variant: 1 }]
	});
	const getterOnly = Object.defineProperty({ min: 'x' }, 'data', { enumerable: true, get: () => ['a'] });
	assert.deepEqual(codes(axis, getterOnly), ['CFG_AMBIGUOUS info $']);
	// An earlier rule that decides makes a later undecidable one irrelevant.
	const ordered = s.union([value, category], {
		discriminator: 'type',
		defaultVariant: 0,
		defaultWhen: [
			{ test: 'truthy', property: 'categories', variant: 1 },
			{ test: 'truthy', property: 'data', variant: 1 }
		]
	});
	assert.deepEqual(codes(ordered, Object.defineProperty({ categories: ['a'] }, 'data', { get: () => 1 })), []);
	// A getter discriminator is not an absent one: the runtime reads it, so no default applies.
	const getterType = Object.defineProperty({ min: 'x' }, 'type', { enumerable: true, get: () => 'category' });
	assert.deepEqual(codes(axis, getterType), ['CFG_AMBIGUOUS info $']);
});

// ECharts visualMap (component/visualMap/installCommon.js): `!categories && (!(pieces ? pieces.length > 0
// : splitNumber > 0) || calculable) ? 'continuous' : 'piecewise'`.
const continuous = s.object({ type: s.string(['continuous']), calculable: s.boolean(), min: s.number() });
const piecewise = s.object({
	type: s.string(['piecewise']),
	categories: s.array(s.string()),
	pieces: s.array(s.object({})),
	splitNumber: s.number(),
	min: s.number(),
	showLabel: s.boolean()
});
const visualMap = s.union([continuous, piecewise], {
	discriminator: 'type',
	defaultVariant: 0,
	defaultWhen: [
		{ test: 'truthy', property: 'categories', variant: 1 },
		{ test: 'truthy', property: 'calculable', variant: 0 },
		{ test: 'nonEmpty', property: 'pieces', variant: 1 },
		{ test: 'truthy', property: 'pieces', variant: 0 },
		{ test: 'positive', property: 'splitNumber', variant: 1 }
	]
});
const piecewiseCheck = ['CFG_TYPE error $.showLabel'];
const continuousCheck = ['CFG_UNKNOWN_KEY warning $.showLabel'];

test('nonEmpty and positive mirror `length > 0` and `> 0` exactly where the value decides them', () => {
	assert.deepEqual(codes(visualMap, { categories: ['a'], calculable: true, showLabel: 1 }), [
		'CFG_UNKNOWN_KEY warning $.calculable',
		...piecewiseCheck
	]);
	assert.deepEqual(codes(visualMap, { pieces: [{}], showLabel: 1 }), piecewiseCheck);
	assert.deepEqual(codes(visualMap, { pieces: [{}], calculable: true, showLabel: 1 }), [
		'CFG_UNKNOWN_KEY warning $.pieces',
		...continuousCheck
	]);
	assert.deepEqual(codes(visualMap, { pieces: [], splitNumber: 5, showLabel: 1 }), [
		'CFG_UNKNOWN_KEY warning $.pieces',
		'CFG_UNKNOWN_KEY warning $.splitNumber',
		'CFG_UNKNOWN_KEY warning $.showLabel'
	]);
	assert.deepEqual(codes(visualMap, { splitNumber: 5, showLabel: 1 }), piecewiseCheck);
	assert.deepEqual(codes(visualMap, { splitNumber: 0, showLabel: 1 }), [
		'CFG_UNKNOWN_KEY warning $.splitNumber',
		'CFG_UNKNOWN_KEY warning $.showLabel'
	]);
	assert.deepEqual(codes(visualMap, { showLabel: 1 }), continuousCheck);
	assert.deepEqual(codes(visualMap, { pieces: new Float32Array(1), showLabel: 1 }), [
		'CFG_TYPE error $.pieces[0]',
		...piecewiseCheck
	]);
});

test('nonEmpty and positive on a value they cannot decide without coercion are ambiguous (A21)', () => {
	// `{ length: 1 }.length > 0` and `'3' > 0` are decided by the runtime, but only by coercion we do not run.
	for (const undecidable of [{ pieces: { length: 1 } }, { pieces: 'ab' }, { splitNumber: '3' }, { splitNumber: {} }])
		assert.deepEqual(codes(visualMap, { ...undecidable, min: 'x' }), ['CFG_AMBIGUOUS info $']);
	// Falsy values never coerce to a positive number: `null > 0`, `'' > 0`, `false > 0` are all false.
	for (const falsy of [null, '', false, Number.NaN])
		assert.deepEqual(codes(visualMap, { splitNumber: falsy, min: 'x' }).slice(-1), ['CFG_TYPE error $.min']);
});
