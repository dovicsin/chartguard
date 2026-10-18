import assert from 'node:assert/strict';
import test from 'node:test';

import { manifestFromArtifact } from '../dist/index.js';
import { artifact, closedRoot, problems, prop } from './fixtures.mjs';

test('malformed artifacts report every problem with its path', () => {
	assert.deepEqual(problems(artifact(closedRoot, { irVersion: 2 })), ['$.irVersion: expected 1']);
	assert.deepEqual(problems(artifact(closedRoot, { libraryVersion: '4.x' })), [
		'$.libraryVersion: expected an exact version, got "4.x"'
	]);
	assert.deepEqual(problems(artifact({ kind: 'ref', ref: 'Missing' })), ['$.root: unresolved ref "Missing"']);
	assert.deepEqual(problems(artifact({ kind: 'tuple' })), ['$.root: unknown node kind "tuple"']);
	assert.deepEqual(problems('nope'), ['$: expected an object']);
});

test('provenance must trace to recorded, pinned sources', () => {
	const withProvenance = (provenance) =>
		artifact({ kind: 'object', additional: 'closed', properties: { a: { node: { kind: 'number' }, provenance } } });
	assert.deepEqual(problems(withProvenance({ confidence: 'authoritative', sources: [] })), [
		'$.root.properties.a.provenance: authoritative provenance needs at least one source'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'authoritative', sources: [{ source: 'docs' }] })), [
		'$.root.properties.a.provenance: authoritative source "docs" has no integrity pin'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'derived', sources: [{ source: 'ghost' }] })), [
		'$.root.properties.a.provenance: unknown source "ghost"'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'sure' })), [
		'$.root.properties.a.provenance: unknown confidence "sure"'
	]);
	assert.deepEqual(
		problems(artifact({ kind: 'object', additional: 'closed', properties: { a: { node: { kind: 'number' } } } })),
		['$.root.properties.a.provenance: expected an object']
	);
});

test('excessively deep artifacts are rejected instead of overflowing the stack', () => {
	let root = { kind: 'number' };
	for (let depth = 0; depth < 300; depth++) root = { kind: 'array', items: root };
	assert.match(problems(artifact(root)).join('\n'), /maximum depth/);
});

test('loading a malformed artifact throws one error listing all problems', () =>
	assert.throws(() => manifestFromArtifact(artifact({ kind: 'ref', ref: 'Missing' }, { coverage: 'most' })), {
		message: 'Invalid schema artifact:\n$.coverage: expected "partial" or "full"\n$.root: unresolved ref "Missing"'
	}));

test('header, source and node shape problems are all reported', () => {
	const broken = {
		...artifact({ kind: 'union', anyOf: [] }),
		library: '',
		generator: { name: 'x' },
		sources: { bad: { kind: 'ftp', integrity: 1 }, worse: 'x' },
		definitions: {
			A: { kind: 'object', additional: 'maybe', properties: { p: 'x' } },
			B: { kind: 'object', additional: 'open', properties: 'x' },
			C: { kind: 'literal', value: {} },
			D: { kind: 'record', values: { kind: 'scriptable', value: 'x' } }
		}
	};
	assert.deepEqual(problems(broken), [
		'$.library: expected a non-empty string',
		'$.generator: expected { name, version } strings',
		'$.sources.bad: unknown source kind "ftp"',
		'$.sources.bad: expected a locator string',
		'$.sources.bad: expected a license string',
		'$.sources.bad: integrity and retrieved must be strings when present',
		'$.sources.worse: expected an object',
		'$.definitions.A.properties.p: expected an object',
		'$.definitions.A: expected additional to be "closed", "open" or "unknown"',
		'$.definitions.B.properties: expected an object',
		'$.definitions.C: expected a primitive literal value',
		'$.definitions.D.values.value: expected an object',
		'$.root: expected a non-empty anyOf array'
	]);
	assert.deepEqual(problems({ ...artifact(closedRoot), sources: [], definitions: 'x' }), [
		'$.definitions: expected an object',
		'$.sources: expected an object',
		'$.root.provenance: unknown source "npm"',
		'$.root.properties.type.provenance: unknown source "npm"',
		'$.root.properties.height.provenance: unknown source "npm"'
	]);
});

test('provenance sources must be a list of known references', () => {
	const root = (provenance) => artifact({ kind: 'number', provenance });
	assert.deepEqual(problems(root({ confidence: 'manual', sources: 'npm' })), [
		'$.root.provenance: expected sources to be an array'
	]);
	assert.deepEqual(problems(root({ confidence: 'manual', sources: [{ source: 7 }] })), [
		'$.root.provenance: unknown source number'
	]);
	assert.deepEqual(problems(root({ confidence: 'manual', sources: ['npm'] })), [
		'$.root.provenance: expected { source } references'
	]);
});

test('required must be a boolean and discriminated members must carry a literal discriminator', () => {
	const root = {
		kind: 'union',
		discriminator: 'type',
		anyOf: [
			{ kind: 'object', additional: 'closed', properties: { type: prop({ kind: 'string' }, { required: 'yes' }) } },
			{ kind: 'ref', ref: 'Loose' },
			{ kind: 'object', additional: 'closed', properties: { type: prop({ kind: 'literal', value: 'ok' }) } }
		]
	};
	const definitions = { Loose: { kind: 'object', additional: 'closed', properties: {} } };
	assert.deepEqual(problems(artifact(root, { definitions })), [
		'$.root.anyOf[0].properties.type: required must be a boolean',
		'$.root.anyOf[0]: discriminator "type" must be a literal property of every object member',
		'$.root.anyOf[1]: discriminator "type" must be a literal property of every object member'
	]);
});
