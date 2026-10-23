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

test("TypeScript's mapped types (Partial, Pick, Omit, Record, Required, Readonly) keep the properties they map, not an empty open object (D3, D6)", () => {
	const entry = [
		'interface Font { size: number; family: string; weight?: "bold" | "normal" }',
		'export type U = {',
		'\tpartial: Partial<Font>;',
		"\tpicked: Pick<Font, 'size'>;",
		"\tomitted: Omit<Font, 'family'>;",
		"\trecord: Record<'top' | 'left', number>;",
		'\trequired: Required<Font>;',
		'\treadonly: Readonly<Font>;',
		'\tnested: Partial<Partial<Font>>;',
		'};'
	].join('\n');
	const { program, checker, entry: file } = createEntryProgram(ROOT, entry);
	const emitter = new TypeEmitter({ program, checker, sourceId: 't', packageName: 'test' });
	emitter.emit(exportedAliasTypes(checker, file).get('U'));
	const { definitions } = emitter;
	const keys = (name) => {
		let node = definitions.U.properties[name].node;
		while (node.kind === 'ref') node = definitions[node.ref];
		return [node.kind, node.additional, Object.keys(node.properties ?? {}).sort()];
	};
	assert.deepEqual(keys('partial'), ['object', 'closed', ['family', 'size', 'weight']]);
	assert.deepEqual(keys('picked'), ['object', 'closed', ['size']]);
	assert.deepEqual(keys('omitted'), ['object', 'closed', ['size', 'weight']]);
	assert.deepEqual(keys('record'), ['object', 'closed', ['left', 'top']]);
	assert.deepEqual(keys('required'), ['object', 'closed', ['family', 'size', 'weight']]);
	assert.deepEqual(keys('readonly'), ['object', 'closed', ['family', 'size', 'weight']]);
	assert.deepEqual(keys('nested'), ['object', 'closed', ['family', 'size', 'weight']]);
	// None of them is a platform object.
	assert.equal(JSON.stringify(definitions).includes('"host"'), false);
});

test('a platform class (Date, CanvasGradient, HTMLElement) is a host object: it names its class, and a plain object is not one (K2)', () => {
	const entry = 'export type U = { d: Date; g: CanvasGradient; e: HTMLElement; wrapped: Partial<CanvasGradient> };';
	const { program, checker, entry: file } = createEntryProgram(ROOT, entry);
	const emitter = new TypeEmitter({ program, checker, sourceId: 't', packageName: 'test' });
	emitter.emit(exportedAliasTypes(checker, file).get('U'));
	const { definitions } = emitter;
	const resolved = (name) => definitions[definitions.U.properties[name].node.ref];
	assert.deepEqual(resolved('d'), { kind: 'object', additional: 'open', properties: {}, host: 'Date' });
	assert.deepEqual(resolved('g'), { kind: 'object', additional: 'open', properties: {}, host: 'CanvasGradient' });
	assert.deepEqual(resolved('e'), { kind: 'object', additional: 'open', properties: {}, host: 'HTMLElement' });
	assert.equal(resolved('wrapped').host, 'CanvasGradient');
	// An options dictionary the library declares has no constructor: opaque, but not a platform object.
	const dictionary = createEntryProgram(ROOT, 'export type V = { f: Intl.NumberFormatOptions };');
	const plain = new TypeEmitter({
		program: dictionary.program,
		checker: dictionary.checker,
		sourceId: 't',
		packageName: 'test'
	});
	plain.emit(exportedAliasTypes(dictionary.checker, dictionary.entry).get('V'));
	const f = plain.definitions.V.properties.f.node;
	assert.deepEqual(f.kind === 'ref' ? plain.definitions[f.ref] : f, {
		kind: 'object',
		additional: 'open',
		properties: {}
	});
});
