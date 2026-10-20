import assert from 'node:assert/strict';
import test from 'node:test';

import { lowerArtifact, s, validateConfig } from '../dist/index.js';
import { artifact, problems, prop, typed } from './fixtures.mjs';

const tier = (confidence) => ({ confidence, sources: confidence === 'unknown' ? [] : [{ source: 'npm' }] });
const at = (confidence, node, extra = {}) => ({ node, provenance: tier(confidence), ...extra });
const closed = (properties, provenance = typed('Options')) => ({
	kind: 'object',
	additional: 'closed',
	provenance,
	properties
});
const Point = closed({ x: prop({ kind: 'number' }) });
const lowered = (root) => lowerArtifact(artifact(root, { definitions: { Point } }));
const report = (manifest, config) =>
	validateConfig(config, manifest).diagnostics.map((d) => `${d.severity} ${d.confidence} ${d.code} ${d.path}`);

test('each tier claims what its evidence allows: authoritative confirmed, derived and manual likely', () => {
	const { manifest } = lowered(
		closed({
			pinned: prop({ kind: 'number' }),
			derived: at('derived', { kind: 'number' }),
			manual: at('manual', { kind: 'string' })
		})
	);
	assert.deepEqual(report(manifest, { pinned: 'a', derived: 'b', manual: 1 }), [
		'error certain CFG_TYPE $.pinned',
		'warning inferred CFG_TYPE $.derived',
		'warning inferred CFG_TYPE $.manual'
	]);
	const likely = validateConfig({ derived: 'b' }, manifest);
	assert.deepEqual([likely.valid, likely.status], [true, 'partial']);
	assert.deepEqual([validateConfig({ derived: 1 }, manifest).status], ['valid']);
});

test('an unknown fact claims nothing: its value is not checked, it is not required, coverage is partial', () => {
	const { manifest, lossy } = lowered(
		closed({ known: prop({ kind: 'number' }), guessed: at('unknown', { kind: 'number' }, { required: true }) })
	);
	assert.deepEqual(lossy, ['$.guessed']);
	assert.equal(manifest.coverage, 'partial');
	assert.deepEqual(report(manifest, { guessed: 'anything' }), []);
	assert.deepEqual(report(manifest, {}), []);
	const { manifest: unknownNode } = lowered(closed({ a: prop({ kind: 'number', provenance: tier('unknown') }) }));
	assert.deepEqual(report(unknownNode, { a: 'x' }), []);
});

test('the weakest fact on the path wins; a shared definition stays confirmed where it is reached authoritatively', () => {
	const ref = { kind: 'ref', ref: 'Point' };
	const { manifest } = lowered(
		closed({ pinned: prop(ref), derived: at('derived', ref), list: at('derived', { kind: 'array', items: ref }) })
	);
	assert.deepEqual(report(manifest, { pinned: { x: 'a' }, derived: { x: 'b' }, list: [{ x: 'c' }] }), [
		'error certain CFG_TYPE $.pinned.x',
		'warning inferred CFG_TYPE $.derived.x',
		'warning inferred CFG_TYPE $.list[0].x'
	]);
	// The derived path weakens a copy: the shared node is unchanged, and the derived array still shares it.
	const { pinned, derived, list } = manifest.root.properties;
	assert.equal(pinned.inferred, undefined);
	assert.equal(derived.inferred, true);
	assert.notEqual(derived, pinned);
	assert.equal(list.element, pinned);
});

test('required, enum, unknown-key, variant and deprecation findings are weakened alike; undecided ones stay undecided', () => {
	const kind = {
		kind: 'union',
		anyOf: [
			{ kind: 'literal', value: 'a' },
			{ kind: 'literal', value: 'b' }
		]
	};
	const variant = (type) => closed({ type: prop({ kind: 'literal', value: type }) });
	const shape = {
		kind: 'union',
		anyOf: [
			{ kind: 'ref', ref: 'A' },
			{ kind: 'ref', ref: 'B' }
		],
		discriminator: 'type',
		provenance: tier('derived')
	};
	const inner = closed({
		need: prop({ kind: 'number' }, { required: true }),
		kind: prop(kind),
		old: { ...prop({ kind: 'number' }), deprecated: { message: 'Old.' } },
		later: prop({ kind: 'unknown' })
	});
	const root = closed({ inner: at('manual', inner), shape: prop(shape) });
	const { manifest } = lowerArtifact(
		artifact(root, { coverage: 'full', definitions: { A: variant('a'), B: variant('b') } })
	);
	assert.deepEqual(report(manifest, { inner: { kind: 'c', old: 1, extra: 1, later: 1 }, shape: { type: 'z' } }), [
		'warning inferred CFG_REQUIRED $.inner.need',
		'warning inferred CFG_ENUM $.inner.kind',
		'warning inferred CFG_DEPRECATED $.inner.old',
		'warning unknown CFG_UNKNOWN_KEY $.inner.extra',
		'warning inferred CFG_ENUM $.shape.type'
	]);
});

test("a required key is weakened by its own property's tier, even in an authoritative object", () => {
	const { manifest } = lowered(
		closed({
			a: prop({ kind: 'number' }, { required: true }),
			b: at('derived', { kind: 'number' }, { required: true })
		})
	);
	assert.deepEqual(report(manifest, {}), ['error certain CFG_REQUIRED $.a', 'warning inferred CFG_REQUIRED $.b']);
});

test("an object's own tier governs only whether it is closed; its properties keep their own", () => {
	const { manifest } = lowerArtifact(
		artifact(closed({ a: prop({ kind: 'number' }) }, tier('derived')), { coverage: 'full' })
	);
	assert.deepEqual(report(manifest, { a: 'x', b: 1 }), [
		'error certain CFG_TYPE $.a',
		'warning unknown CFG_UNKNOWN_KEY $.b'
	]);
});

test('a recursive definition reached through a derived property is weakened at every depth and keeps its cycle', () => {
	const Node = closed({ name: prop({ kind: 'string' }), next: at('derived', { kind: 'ref', ref: 'Node' }) });
	const { manifest } = lowerArtifact(artifact({ kind: 'ref', ref: 'Node' }, { definitions: { Node } }));
	assert.deepEqual(report(manifest, { name: 1, next: { name: 2, next: { name: 3 } } }), [
		'error certain CFG_TYPE $.name',
		'warning inferred CFG_TYPE $.next.name',
		'warning inferred CFG_TYPE $.next.next.name'
	]);
});

test('a curated or plugin schema states its own certainty with `inferred`', () => {
	const root = s.object({ sure: s.number(), guess: { ...s.object({ size: s.number() }), inferred: true } });
	const manifest = { library: 'demo', version: '1.0.0', coverage: 'partial', source: 'demo', root };
	assert.deepEqual(report(manifest, { sure: 'a', guess: { size: 'b', colour: 1 } }), [
		'error certain CFG_TYPE $.sure',
		'warning inferred CFG_TYPE $.guess.size',
		'warning unknown CFG_UNKNOWN_KEY $.guess.colour'
	]);
});

test('tiers are checked: an unknown tier is an artifact problem, an authoritative one needs a source', () => {
	assert.deepEqual(problems(artifact(closed({ a: at('sure', { kind: 'number' }) }))), [
		'$.root.properties.a.provenance: unknown confidence "sure"'
	]);
});
