import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { TypeEmitter } from '../lib/emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from '../lib/program.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

test('only known homomorphic wrappers pass primitives through; any other alias keeps its object shape', () => {
	const entry = [
		'type Wrap<T> = { v: T };',
		'type Pair<T> = { a: T; b: T };',
		'type Partialish<T> = { [K in keyof T]?: T[K] };',
		"export type U = { w: Wrap<'x'>; p: Pair<number>; q: Partialish<number> };"
	].join('\n');
	const { program, checker, entry: file } = createEntryProgram(ROOT, entry);
	const emit = (wrappers) => {
		const emitter = new TypeEmitter({ program, checker, sourceId: 't', packageName: 'test', wrappers });
		const node = emitter.emit(exportedAliasTypes(checker, file).get('U'));
		return { node, definitions: emitter.definitions };
	};
	const strict = emit(new Set());
	const shape = (name) => strict.definitions[strict.definitions.U.properties[name].node.ref];
	assert.equal(shape('w').kind, 'object');
	assert.deepEqual(Object.keys(shape('w').properties), ['v']);
	assert.deepEqual(Object.keys(shape('p').properties), ['a', 'b']);
	const lenient = emit(new Set(['Partialish']));
	assert.deepEqual(lenient.definitions.U.properties.q.node, { kind: 'number' });
	assert.equal(lenient.definitions.U.properties.w.node.kind, 'ref');
});

test("TypeScript's global Function interfaces are functions, not platform objects (D18)", () => {
	const entry = 'export type U = { f: Function; c: CallableFunction; n: NewableFunction; d: Date };';
	const { program, checker, entry: file } = createEntryProgram(ROOT, entry);
	const emitter = new TypeEmitter({ program, checker, sourceId: 't', packageName: 'test' });
	emitter.emit(exportedAliasTypes(checker, file).get('U'));
	const { properties } = emitter.definitions.U;
	assert.deepEqual(
		[properties.f.node, properties.c.node, properties.n.node],
		[{ kind: 'function' }, { kind: 'function' }, { kind: 'function' }]
	);
	assert.equal(properties.d.node.kind, 'ref');
});
