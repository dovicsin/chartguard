import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact, lowerArtifact, s, validateConfig } from '../dist/index.js';
import { artifact, prop } from './fixtures.mjs';

/** A tree node whose `children` are tree nodes, as echarts' tree and treemap series declare them. */
function tree() {
	return artifact(
		{ kind: 'array', items: { kind: 'ref', ref: 'Node' } },
		{
			definitions: {
				Node: {
					kind: 'object',
					additional: 'closed',
					properties: {
						name: prop({ kind: 'string' }),
						children: prop({ kind: 'array', items: { kind: 'ref', ref: 'Node' } })
					}
				}
			}
		}
	);
}
const findings = (manifest, value) => validateConfig(value, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);

test('a recursive definition is checked at every depth, not cut off as unknown', () => {
	const { manifest, lossy } = lowerArtifact(tree());
	assert.deepEqual(lossy, []);
	assert.equal(manifest.coverage, 'full');
	const deep = [{ name: 'a', children: [{ name: 'b', children: [{ name: 7, colour: 'x' }] }] }];
	assert.deepEqual(findings(manifest, deep), [
		'CFG_TYPE $[0].children[0].children[0].name',
		'CFG_UNKNOWN_KEY $[0].children[0].children[0].colour'
	]);
});

test('a recursive schema over a cyclic value stops at the cycle, and a deep value at the depth limit', () => {
	const { manifest } = lowerArtifact(tree());
	const node = { name: 'loop', children: [] };
	node.children.push(node);
	assert.deepEqual(findings(manifest, [node]), ['CFG_CYCLE $[0].children[0]']);
	let deep = { name: 'leaf' };
	for (let level = 0; level < 60; level++) deep = { name: String(level), children: [deep] };
	const codes = findings(manifest, [deep]).map((finding) => finding.split(' ')[0]);
	assert.deepEqual(codes, ['CFG_DEPTH']);
});

test('unions that refer to each other only through unions terminate and stay checkable', () => {
	const cyclic = artifact(
		{ kind: 'ref', ref: 'A' },
		{
			definitions: {
				A: { kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'ref', ref: 'B' }] },
				B: { kind: 'union', anyOf: [{ kind: 'string' }, { kind: 'ref', ref: 'A' }] }
			}
		}
	);
	const { manifest } = lowerArtifact(cyclic);
	assert.deepEqual(findings(manifest, 1), []);
	assert.deepEqual(findings(manifest, 'x'), []);
	assert.deepEqual(findings(manifest, true), ['CFG_TYPE $']);
});

test('a property with metadata (a handler, a deprecation) on a recursive reference keeps both', () => {
	const node = {
		kind: 'object',
		additional: 'closed',
		properties: {
			name: prop({ kind: 'string' }),
			next: { ...prop({ kind: 'ref', ref: 'Node' }), deprecated: { message: 'Use children.' } }
		}
	};
	const { manifest } = lowerArtifact(artifact({ kind: 'ref', ref: 'Node' }, { definitions: { Node: node } }));
	assert.deepEqual(findings(manifest, { next: { next: { name: 1 } } }), [
		'CFG_DEPRECATED $.next',
		'CFG_DEPRECATED $.next.next',
		'CFG_TYPE $.next.next.name'
	]);
});

test('keys that are not identifiers are quoted in paths, so every path names exactly one place', () => {
	const root = s.object({ title: s.object({ text: s.string() }) });
	const manifest = { library: 'test', version: '1', coverage: 'partial', source: 'test', root };
	const paths = validateConfig(
		{ title: { 'te.xt': 1, 'a b': 2, '': 3, 'say "hi"': 4, $ok_1: 5 } },
		manifest
	).diagnostics.map((d) => d.path);
	assert.deepEqual(paths, [
		'$.title["te.xt"]',
		'$.title["a b"]',
		'$.title[""]',
		'$.title["say \\"hi\\""]',
		'$.title.$ok_1'
	]);
});

test('a walk is bounded in total, not only per container: a huge config is truncated once, with a finding', () => {
	const rows = Array.from({ length: 300 }, () => Array.from({ length: 4000 }, () => 1));
	const manifest = {
		library: 'test',
		version: '1',
		coverage: 'partial',
		source: 'test',
		root: s.object({ data: s.array(s.array(s.number())) })
	};
	const result = validateConfig({ data: rows }, manifest);
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.severity}`),
		['CFG_TRUNCATED warning']
	);
	assert.equal(result.status, 'partial');
});

/** An object member with a literal `type`, for a discriminated union. */
const typedObject = (type) => ({
	kind: 'object',
	additional: 'closed',
	properties: { type: prop({ kind: 'literal', value: type }), size: prop({ kind: 'number' }) }
});

test('a default variant that leads back to its own union is rejected as an artifact and never recurses without end (H6)', () => {
	// `defaultVariant` picks member 0, the union itself: the walk would choose it again and again.
	const looping = artifact(
		{ kind: 'ref', ref: 'Axis' },
		{
			definitions: {
				Axis: {
					kind: 'union',
					anyOf: [
						{ kind: 'ref', ref: 'Axis' },
						{ kind: 'ref', ref: 'Value' }
					],
					discriminator: 'type',
					defaultVariant: 0
				},
				Value: typedObject('value')
			}
		}
	);
	assert.match(checkArtifact(looping).problems.join('\n'), /\$\.definitions\.Axis: .*leads back to the union/u);
	// The engine itself never overflows the stack on such a schema: the variant is not decided.
	const { manifest } = lowerArtifact(looping);
	assert.deepEqual(findings(manifest, { size: 'x' }), ['CFG_AMBIGUOUS $']);
	assert.deepEqual(findings(manifest, { type: 'value', size: 'x' }), ['CFG_TYPE $.size']);
	// Through another union, by a defaultWhen rule, or by a selectWhen rule.
	const viaOther = artifact(
		{ kind: 'ref', ref: 'A' },
		{
			definitions: {
				A: {
					kind: 'union',
					anyOf: [{ kind: 'ref', ref: 'B' }, typedObject('a')],
					discriminator: 'type',
					defaultVariant: 0
				},
				B: {
					kind: 'union',
					anyOf: [typedObject('b'), { kind: 'ref', ref: 'A' }],
					discriminator: 'type',
					defaultWhen: [{ test: 'truthy', property: 'size', variant: 1 }]
				}
			}
		}
	);
	assert.match(checkArtifact(viaOther).problems.join('\n'), /leads back to the union/u);
	assert.deepEqual(findings(lowerArtifact(viaOther).manifest, { size: 1 }), ['CFG_AMBIGUOUS $']);
});

test('an alias that only refers to itself has no shape: rejected as an artifact, never checked as one (H6)', () => {
	const alias = artifact(
		{ kind: 'ref', ref: 'A' },
		{ definitions: { A: { kind: 'ref', ref: 'B' }, B: { kind: 'ref', ref: 'A' } } }
	);
	assert.match(checkArtifact(alias).problems.join('\n'), /\$\.definitions\.A: .*never reaches a shape/u);
	const self = artifact(
		{ kind: 'ref', ref: 'U' },
		{ definitions: { U: { kind: 'union', anyOf: [{ kind: 'ref', ref: 'U' }] } } }
	);
	assert.match(checkArtifact(self).problems.join('\n'), /\$\.definitions\.U: .*never reaches a shape/u);
	// Lowered anyway, it is unknown and lossy: never a confirmed error, never full coverage.
	for (const looping of [alias, self]) {
		const { manifest, lossy } = lowerArtifact(looping);
		assert.equal(manifest.coverage, 'partial');
		assert.ok(lossy.length > 0);
		assert.deepEqual(findings(manifest, { a: 1 }), []);
	}
	// A recursive union with a shape of its own is well-founded.
	const list = artifact(
		{ kind: 'ref', ref: 'L' },
		{
			definitions: {
				L: { kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'array', items: { kind: 'ref', ref: 'L' } }] }
			}
		}
	);
	assert.deepEqual(checkArtifact(list).problems, []);
});

test('a hand-built schema whose union is its own only member claims nothing', () => {
	const union = { kind: 'union', anyOf: [] };
	union.anyOf.push(union);
	const manifest = { library: 't', version: '1', coverage: 'full', source: 't', root: union };
	assert.deepEqual(findings(manifest, { a: 1 }), []);
	const looping = { kind: 'union', anyOf: [], discriminator: 'type', defaultVariant: 0 };
	looping.anyOf.push(looping, s.object({ type: s.string(['v']) }));
	assert.deepEqual(findings({ ...manifest, root: looping }, {}), ['CFG_AMBIGUOUS $']);
});
