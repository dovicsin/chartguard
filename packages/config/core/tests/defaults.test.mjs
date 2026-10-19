import assert from 'node:assert/strict';
import test from 'node:test';

import { s, validateConfig } from '../dist/index.js';

// Which variant the runtime picks when the discriminator is absent: conditional rules, a value
// read elsewhere in the config, and the cases where that cannot be decided without running code.
const manifest = (root, coverage = 'partial') => ({ library: 'test', version: '1', coverage, source: 'test', root });
const codes = (root, value) =>
	validateConfig(value, manifest(root)).diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`);

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

// Highcharts: a series without `type` takes `chart.type`, which defaults to 'line' (Chart#initSeries).
const lineSeries = s.object({ type: s.string(['line']), step: s.boolean() });
const pieSeries = s.object({ type: s.string(['pie']), innerSize: s.string() });
const seriesUnion = s.union([lineSeries, pieSeries], {
	discriminator: 'type',
	extensible: true,
	defaultFrom: { path: ['chart', 'type'], fallback: 'line' }
});
const chartRoot = s.object({ chart: s.object({ type: s.string() }), series: s.array(seriesUnion) });

test('a default read from elsewhere in the config: the variant the root value names, else the fallback', () => {
	assert.deepEqual(codes(chartRoot, { chart: { type: 'pie' }, series: [{ innerSize: 1 }] }), [
		'CFG_TYPE error $.series[0].innerSize'
	]);
	assert.deepEqual(codes(chartRoot, { series: [{ step: 'x' }] }), ['CFG_TYPE error $.series[0].step']);
	assert.deepEqual(codes(chartRoot, { chart: {}, series: [{ step: 'x' }] }), ['CFG_TYPE error $.series[0].step']);
	assert.deepEqual(codes(chartRoot, { chart: { type: undefined }, series: [{ step: 'x' }] }), [
		'CFG_TYPE error $.series[0].step'
	]);
	// An explicit type still wins.
	assert.deepEqual(codes(chartRoot, { chart: { type: 'pie' }, series: [{ type: 'line', step: 'x' }] }), [
		'CFG_TYPE error $.series[0].step'
	]);
});

test('a default read from elsewhere stays inconclusive whenever the runtime might read something else (A21)', () => {
	const getter = Object.defineProperty({}, 'type', { enumerable: true, get: () => 'pie' });
	for (const chart of [{ type: 'treemap' }, { type: 7 }, { type: '' }, getter, 'pie', ['pie']])
		assert.deepEqual(
			codes(chartRoot, { chart, series: [{ innerSize: 1 }] }).at(-1),
			'CFG_AMBIGUOUS info $.series[0]',
			JSON.stringify(chart)
		);
	const chartGetter = Object.defineProperty({ series: [{ innerSize: 1 }] }, 'chart', {
		enumerable: true,
		get: () => ({ type: 'pie' })
	});
	assert.deepEqual(codes(chartRoot, chartGetter), ['CFG_AMBIGUOUS info $.series[0]', 'CFG_DYNAMIC warning $.chart']);
});

test('a default read from elsewhere is checked against the registry like any default the runtime picks', () => {
	const registered = { ...seriesUnion, registry: { id: 'series', prefix: '', enforced: true } };
	const root = s.object({ chart: s.object({ type: s.string() }), series: s.array(registered) });
	const result = validateConfig({ chart: { type: 'pie' }, series: [{}] }, manifest(root), {
		registries: { series: { names: ['line'], complete: true } }
	});
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_UNREGISTERED $.series[0]']
	);
});
