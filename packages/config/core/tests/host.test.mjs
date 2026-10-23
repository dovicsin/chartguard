import assert from 'node:assert/strict';
import test from 'node:test';

import { manifestFromArtifact, validateConfig } from '../dist/index.js';
import { artifact, problems, prop, typed } from './fixtures.mjs';

/**
 * Platform objects in a union (K2): `number | Date | { value, itemStyle }` must not leave a plain data
 * item unchecked. A plain object is never a platform object; a class instance may be either, so nothing
 * is claimed for it.
 */
const host = (name) => ({ kind: 'object', additional: 'open', properties: {}, host: name });
const item = {
	kind: 'object',
	additional: 'closed',
	provenance: typed('DataItem'),
	properties: { value: prop({ kind: 'number' }), color: prop({ kind: 'string' }) }
};
const root = {
	kind: 'object',
	additional: 'closed',
	provenance: typed('Series'),
	properties: {
		data: prop({ kind: 'array', items: { kind: 'union', anyOf: [{ kind: 'number' }, host('Date'), item] } })
	}
};
const codes = (config) =>
	validateConfig(config, manifestFromArtifact(artifact(root))).diagnostics.map(
		(d) => `${d.code} ${d.severity} ${d.path}`
	);

test('a plain object in a union with a platform object is checked against the plain member', () => {
	assert.deepEqual(codes({ data: [1, { value: 2, color: 'red' }] }), []);
	assert.deepEqual(codes({ data: [{ value: 2, color: 5 }] }), ['CFG_TYPE error $.data[0].color']);
	assert.deepEqual(codes({ data: [{ value: 2, colour: 'red' }] }), ['CFG_UNKNOWN_KEY error $.data[0].colour']);
	// A null-prototype object is plain data too.
	assert.deepEqual(codes({ data: [Object.assign(Object.create(null), { value: 'x' })] }), [
		'CFG_TYPE error $.data[0].value'
	]);
});

test('a platform or class instance may be either member: nothing is claimed', () => {
	assert.deepEqual(codes({ data: [new Date(0)] }), ['CFG_AMBIGUOUS info $.data[0]']);
	class Point {
		value = 'x';
	}
	assert.deepEqual(codes({ data: [new Point()] }), ['CFG_AMBIGUOUS info $.data[0]']);
});

test('where only a platform object fits, a plain object is not claimed wrong (runtimes duck-type some of them)', () => {
	const only = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('O'),
		properties: { at: prop(host('HTMLElement')) }
	};
	assert.deepEqual(validateConfig({ at: { any: 1 } }, manifestFromArtifact(artifact(only))).diagnostics, []);
});

test('the IR checks host: a non-empty class name on an object node', () => {
	assert.deepEqual(problems(artifact(root)), []);
	assert.deepEqual(problems(artifact({ ...root, host: '' })), ['$.root: host must be a non-empty class name']);
	assert.deepEqual(problems(artifact({ ...root, host: 5 })), ['$.root: host must be a non-empty class name']);
});

test('a union whose object member accepts everything another accepts is that member: a scriptable copy subsumes the plain one', () => {
	const font = (size) => ({
		kind: 'object',
		additional: 'closed',
		provenance: typed('Font'),
		properties: { size: prop(size), family: prop({ kind: 'string' }) }
	});
	const scriptable = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('ScriptableFont'),
		properties: {
			size: prop({ kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'function' }] }),
			family: prop({ kind: 'union', anyOf: [{ kind: 'string' }, { kind: 'function' }] })
		}
	};
	const schema = (members) => ({
		kind: 'object',
		additional: 'closed',
		provenance: typed('Title'),
		properties: { font: prop({ kind: 'union', anyOf: members }) }
	});
	const check = (members, value) =>
		validateConfig({ font: value }, manifestFromArtifact(artifact(schema(members)))).diagnostics.map(
			(d) => `${d.code} ${d.path}`
		);
	const members = [font({ kind: 'number' }), { kind: 'function' }, scriptable];
	assert.deepEqual(check(members, { size: 'big' }), ['CFG_TYPE $.font.size']);
	assert.deepEqual(check(members, { size: () => 3, famly: 'x' }), ['CFG_UNKNOWN_KEY $.font.famly']);
	assert.deepEqual(check(members, { size: 12, family: 'serif' }), []);
	// Members that each accept something the other does not stay ambiguous: never guessed.
	const other = font({ kind: 'string' });
	assert.deepEqual(check([font({ kind: 'number' }), other], { size: true }), ['CFG_AMBIGUOUS $.font']);
});

test('selectWhen: a rule the runtime applies before the discriminator (ECharts graphic: `elements` makes a component)', () => {
	const component = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Component'),
		properties: {
			type: prop({ kind: 'string' }),
			elements: prop({ kind: 'array', items: { kind: 'unknown' } }),
			left: prop({ kind: 'number' })
		}
	};
	const element = (type, extra) => ({
		kind: 'object',
		additional: 'closed',
		provenance: typed(type),
		properties: { type: prop({ kind: 'literal', value: type }), ...extra }
	});
	const graphic = {
		kind: 'union',
		anyOf: [
			component,
			element('rect', { shape: prop({ kind: 'number' }) }),
			element('text', { text: prop({ kind: 'string' }) })
		],
		discriminator: 'type',
		extensible: true,
		selectWhen: [{ test: 'truthy', property: 'elements', variant: 0 }]
	};
	const options = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('O'),
		properties: { graphic: prop(graphic) }
	};
	assert.deepEqual(problems(artifact(options)), []);
	const check = (value) =>
		validateConfig({ graphic: value }, manifestFromArtifact(artifact(options))).diagnostics.map(
			(d) => `${d.code} ${d.severity} ${d.path}`
		);
	assert.deepEqual(check({ elements: [], left: 'x' }), ['CFG_TYPE error $.graphic.left']);
	// With elements it is a component whatever its type says.
	assert.deepEqual(check({ type: 'rect', elements: [], left: 1 }), []);
	assert.deepEqual(check({ type: 'rect', shape: 'x' }), ['CFG_TYPE error $.graphic.shape']);
	// An extensible union's variant may gain options from a plugin: an unknown key warns.
	assert.deepEqual(check({ type: 'text', txt: 'a' }), ['CFG_UNKNOWN_KEY warning $.graphic.txt']);
	assert.deepEqual(
		check({ type: 'star' }).map((line) => line.split(' ')[0]),
		['CFG_UNKNOWN_VARIANT']
	);
	// An accessor on the rule's property cannot be decided: nothing is claimed.
	assert.deepEqual(
		check(Object.defineProperty({ type: 'rect', shape: 'x' }, 'elements', { get: () => [], enumerable: true })),
		['CFG_AMBIGUOUS info $.graphic']
	);
	// The IR checks the rules like defaultWhen, and a member only a rule selects needs no literal discriminator.
	assert.deepEqual(
		problems(
			artifact({
				...root,
				properties: {
					graphic: prop({ ...graphic, selectWhen: [{ test: 'truthy', property: 'elements', variant: 9 }] })
				}
			})
		).length,
		2
	);
});

test('a discriminator may be a union of literals stored as a definition and referenced', () => {
	const shapes = {
		kind: 'union',
		anyOf: [
			{ kind: 'literal', value: 'rect' },
			{ kind: 'literal', value: 'circle' }
		]
	};
	const path = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Path'),
		properties: { type: prop({ kind: 'ref', ref: 'Shapes' }), shape: prop({ kind: 'number' }) }
	};
	const text = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Text'),
		properties: { type: prop({ kind: 'literal', value: 'text' }) }
	};
	const options = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('O'),
		properties: { el: prop({ kind: 'union', anyOf: [path, text], discriminator: 'type' }) }
	};
	const built = artifact(options, { definitions: { Shapes: shapes } });
	assert.deepEqual(problems(built), []);
	const check = (value) =>
		validateConfig({ el: value }, manifestFromArtifact(built)).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(check({ type: 'circle', shape: 'x' }), ['CFG_TYPE $.el.shape']);
	assert.deepEqual(check({ type: 'text' }), []);
	assert.deepEqual(problems(artifact(options, { definitions: { Shapes: { kind: 'string' } } })).length, 1);
});
