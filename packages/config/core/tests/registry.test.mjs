import assert from 'node:assert/strict';
import test from 'node:test';

import { s, validateConfig } from '../dist/index.js';

const manifest = (root) => ({ library: 'test', version: '1.0.0', coverage: 'partial', source: 'test', root });
const run = (root, value, registries) =>
	validateConfig(value, manifest(root), registries === undefined ? {} : { registries });
const codes = (root, value, registries) =>
	run(root, value, registries).diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`);

// An ECharts-like component: the subtype lives in the runtime class registry as `dataZoom.<type>`.
const slider = s.object({ type: s.string(['slider']), start: s.number() });
const inside = s.object({ type: s.string(['inside']), start: s.number() });
const dataZoom = s.union([slider, inside], {
	discriminator: 'type',
	defaultVariant: 0,
	extensible: true,
	registry: { id: 'runtime', prefix: 'dataZoom.', enforced: true }
});
const root = s.object({ dataZoom });
const treeShaken = (...names) => ({ runtime: { names, complete: true } });
const extensions = (...names) => ({ runtime: { names, complete: false } });

test('without registry context nothing changes: built-ins are checked, unknown variants unresolved', () => {
	assert.deepEqual(codes(root, { dataZoom: { type: 'inside', start: 'x' } }), ['CFG_TYPE error $.dataZoom.start']);
	assert.deepEqual(codes(root, { dataZoom: { type: 'select' } }), ['CFG_UNKNOWN_VARIANT warning $.dataZoom.type']);
});

test('a complete registry: a registered built-in is checked, an unregistered one is a confirmed error', () => {
	const registries = treeShaken('dataZoom.inside');
	assert.deepEqual(codes(root, { dataZoom: { type: 'inside', start: 'x' } }, registries), [
		'CFG_TYPE error $.dataZoom.start'
	]);
	const result = run(root, { dataZoom: { type: 'slider', start: 0 } }, registries);
	assert.equal(result.valid, false);
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.severity, d.path, d.message, d.suggestion]),
		[
			[
				'CFG_UNREGISTERED',
				'error',
				'$.dataZoom.type',
				'"slider" is not registered with the runtime (dataZoom.slider), which rejects it.',
				'Register dataZoom.slider, or use a registered one: inside.'
			]
		]
	);
});

test('a complete registry also applies to the variant the runtime picks by default', () => {
	assert.deepEqual(codes(root, { dataZoom: { start: 0 } }, treeShaken('dataZoom.inside')), [
		'CFG_UNREGISTERED error $.dataZoom'
	]);
	assert.deepEqual(codes(root, { dataZoom: { start: 'x' } }, treeShaken('dataZoom.slider')), [
		'CFG_TYPE error $.dataZoom.start'
	]);
});

test('a registered variant the schema does not know is an extension: accepted, unchecked, partial', () => {
	for (const registries of [treeShaken('dataZoom.select'), extensions('dataZoom.select')]) {
		const result = run(root, { dataZoom: { type: 'select', anything: 1 } }, registries);
		assert.equal(result.valid, true);
		assert.equal(result.status, 'partial');
		assert.deepEqual(
			result.diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`),
			['CFG_REGISTERED_VARIANT info $.dataZoom.type']
		);
	}
});

test('an incomplete registry never makes an unlisted variant an error (unknown stays unknown)', () => {
	const registries = extensions('dataZoom.select');
	assert.deepEqual(codes(root, { dataZoom: { type: 'inside', start: 'x' } }, registries), [
		'CFG_TYPE error $.dataZoom.start'
	]);
	assert.deepEqual(codes(root, { dataZoom: { type: 'selct' } }, registries), [
		'CFG_UNKNOWN_VARIANT warning $.dataZoom.type'
	]);
	assert.deepEqual(codes(root, { dataZoom: {} }, extensions()), []);
});

test('only names under the union prefix count, and a non-string discriminator keeps its usual finding', () => {
	assert.deepEqual(codes(root, { dataZoom: { type: 'inside' } }, treeShaken('series.inside', 'inside')), [
		'CFG_UNREGISTERED error $.dataZoom.type'
	]);
	assert.deepEqual(codes(root, { dataZoom: { type: 7 } }, treeShaken()), [
		'CFG_UNKNOWN_VARIANT warning $.dataZoom.type'
	]);
});

test('a nested union inherits the registry of the union it belongs to (`T | T[]`, scriptables)', () => {
	const list = s.object({ dataZoom: s.union([dataZoom, s.array(dataZoom), s.func()]) });
	assert.deepEqual(codes(list, { dataZoom: [{ type: 'inside' }, { type: 'slider' }] }, treeShaken('dataZoom.inside')), [
		'CFG_UNREGISTERED error $.dataZoom[1].type'
	]);
	assert.deepEqual(codes(list, { dataZoom: { type: 'slider' } }, treeShaken('dataZoom.inside')), [
		'CFG_UNREGISTERED error $.dataZoom.type'
	]);
});

test('a registry id the schema does not use is reported, never silently ignored', () => {
	const result = run(root, { dataZoom: { type: 'inside' } }, { runtme: { names: [], complete: true } });
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.severity, d.path, d.suggestion]),
		[['CFG_UNKNOWN_REGISTRY', 'warning', '$', 'Did you mean "runtime"?']]
	);
	assert.equal(result.status, 'partial');
});

test('a malformed registry context is an input error, reported once, and the config is still validated', () => {
	for (const bad of [{ runtime: { names: 'x', complete: true } }, { runtime: { names: [] } }, { runtime: null }, []])
		assert.deepEqual(codes(root, { dataZoom: { type: 'inside', start: 'x' } }, bad), [
			'CFG_REGISTRY_CONTEXT warning $',
			'CFG_TYPE error $.dataZoom.start'
		]);
});

test('registry contexts are not trusted to stay the same: getters are never run', () => {
	let called = false;
	const sneaky = Object.defineProperty({ complete: true }, 'names', {
		enumerable: true,
		get() {
			called = true;
			return [];
		}
	});
	assert.deepEqual(codes(root, { dataZoom: { type: 'inside' } }, { runtime: sneaky }), [
		'CFG_REGISTRY_CONTEXT warning $'
	]);
	assert.equal(called, false);
});

test('a registry that is not enforced recognises extensions but leaves a missing value to the usual rules', () => {
	// Chart.js reads the chart `type` only through its datasets: with none, an unregistered type renders.
	const chart = s.union([s.object({ type: s.string(['bar']) }), s.object({ type: s.string(['line']) })], {
		discriminator: 'type',
		extensible: true,
		registry: { id: 'controllers', prefix: '', enforced: false }
	});
	const complete = (...names) => ({ controllers: { names, complete: true } });
	assert.deepEqual(codes(chart, { type: 'bar' }, complete('line')), []);
	assert.deepEqual(codes(chart, { type: 'matrix' }, complete('matrix')), ['CFG_REGISTERED_VARIANT info $.type']);
	assert.deepEqual(codes(chart, { type: 'matrx' }, complete('matrix')), ['CFG_UNKNOWN_VARIANT warning $.type']);
});
