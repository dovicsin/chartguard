import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact, lowerArtifact, s, validateConfig } from '../dist/index.js';
import { artifact, prop } from './fixtures.mjs';

/**
 * An option the runtime normalizes to a list and whose entries that are not objects it skips
 * (echarts components, `mappingToExists`): such a value has no effect, a certain `CFG_INEFFECTIVE`
 * warning. Which values are skipped is stated per option, for a value given alone and for a list
 * entry, by kind (`null`, a falsy primitive, any other primitive): a kind the runtime does not skip
 * (it throws on it) keeps its confirmed type error (CG-02-10).
 */
const findings = (manifest, value) =>
	validateConfig(value, manifest).diagnostics.map((d) => `${d.severity} ${d.confidence} ${d.code} ${d.path}`);

const Item = { kind: 'object', additional: 'closed', properties: { size: prop({ kind: 'number' }) } };
const list = {
	kind: 'union',
	anyOf: [
		{ kind: 'ref', ref: 'Item' },
		{ kind: 'array', items: { kind: 'ref', ref: 'Item' } }
	]
};
const ALL = { value: ['falsy', 'truthy'], entries: ['null', 'falsy', 'truthy'] };
const lowered = (property) =>
	lowerArtifact(
		artifact(
			{ kind: 'object', additional: 'closed', nullAsAbsent: true, properties: { items: property, other: prop(list) } },
			{ definitions: { Item } }
		)
	).manifest;

test('an entry the runtime skips because it is not an object is ineffective', () => {
	const manifest = lowered(prop(list, { skips: ALL }));
	assert.deepEqual(findings(manifest, { items: [null, { size: 1 }, 5, 'x', true, 0] }), [
		'warning certain CFG_INEFFECTIVE $.items[0]',
		'warning certain CFG_INEFFECTIVE $.items[2]',
		'warning certain CFG_INEFFECTIVE $.items[3]',
		'warning certain CFG_INEFFECTIVE $.items[4]',
		'warning certain CFG_INEFFECTIVE $.items[5]'
	]);
	// A single value is a list of one; `null` is absent (the root reads it so).
	assert.deepEqual(findings(manifest, { items: 5 }), ['warning certain CFG_INEFFECTIVE $.items']);
	assert.deepEqual(findings(manifest, { items: null }), []);
	// Objects are still checked; an option without the fact keeps its type errors.
	assert.deepEqual(findings(manifest, { items: [null, { size: 'x' }] }), [
		'warning certain CFG_INEFFECTIVE $.items[0]',
		'error certain CFG_TYPE $.items[1].size'
	]);
	assert.deepEqual(findings(manifest, { other: [null] }), ['error certain CFG_TYPE $.other[0]']);
	assert.equal(validateConfig({ items: [null] }, manifest).valid, true);
});

test('only the kinds the runtime skips are ineffective: one it throws on stays a confirmed error', () => {
	// echarts' layout compatibility runs `'x' in option` on every truthy entry of a title: it throws on `5`.
	const manifest = lowered(prop(list, { skips: { value: ['falsy'], entries: ['null', 'falsy'] } }));
	assert.deepEqual(findings(manifest, { items: [null, 0, '', false, 5, 'x'] }), [
		'warning certain CFG_INEFFECTIVE $.items[0]',
		'warning certain CFG_INEFFECTIVE $.items[1]',
		'warning certain CFG_INEFFECTIVE $.items[2]',
		'warning certain CFG_INEFFECTIVE $.items[3]',
		'error certain CFG_TYPE $.items[4]',
		'error certain CFG_TYPE $.items[5]'
	]);
	assert.deepEqual(findings(manifest, { items: 0 }), ['warning certain CFG_INEFFECTIVE $.items']);
	assert.deepEqual(findings(manifest, { items: true }), ['error certain CFG_TYPE $.items']);
	// No entry kind at all: every entry that is not an object is an error.
	const strict = lowered(prop(list, { skips: { value: ['falsy'], entries: [] } }));
	assert.deepEqual(findings(strict, { items: [0] }), ['error certain CFG_TYPE $.items[0]']);
});

test('the fact also holds for a list stored as a shared definition, without changing it for other uses', () => {
	const definitions = { Item, ItemList: list };
	const root = {
		kind: 'object',
		additional: 'closed',
		properties: {
			items: prop({ kind: 'ref', ref: 'ItemList' }, { skips: ALL }),
			other: prop({ kind: 'ref', ref: 'ItemList' })
		}
	};
	const { manifest } = lowerArtifact(artifact(root, { definitions }));
	assert.deepEqual(findings(manifest, { items: [1], other: [1] }), [
		'warning certain CFG_INEFFECTIVE $.items[0]',
		'error certain CFG_TYPE $.other[0]'
	]);
});

test('the fact is checked in an artifact: two lists of known kinds', () => {
	const withSkips = (skips) =>
		artifact(
			{ kind: 'object', additional: 'closed', properties: { items: prop(list, { skips }) } },
			{ definitions: { Item } }
		);
	for (const bad of [true, { value: ['falsy'] }, { value: ['big'], entries: [] }, { value: 'falsy', entries: [] }])
		assert.match(checkArtifact(withSkips(bad)).problems.join('\n'), /skips must be/u, JSON.stringify(bad));
	assert.deepEqual(checkArtifact(withSkips(ALL)).problems, []);
});

test('a hand-built schema states the kinds on the value: an entry of a list, or the value itself', () => {
	const schema = s.object({ items: s.array({ ...s.object({ a: s.number() }), skips: ['null', 'falsy', 'truthy'] }) });
	const manifest = { library: 't', version: '1', coverage: 'partial', source: 't', root: schema };
	assert.deepEqual(findings(manifest, { items: [0, { a: 1 }] }), ['warning certain CFG_INEFFECTIVE $.items[0]']);
});
