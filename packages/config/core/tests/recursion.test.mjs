import assert from 'node:assert/strict';
import test from 'node:test';

import { lowerArtifact, s, validateConfig } from '../dist/index.js';
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
