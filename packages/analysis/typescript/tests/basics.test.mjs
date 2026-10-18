import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';

const named = (source, name = 'config') => extractStaticConfigs(source).objects.find((x) => x.name === name);
const plain = (value) => ({ ...value });
const reasons = (object) => object.diagnostics.map((d) => d.code);

test('extracts const object and spreads safely', () => {
	const c = named(
		'const base = {responsive: true}; const config = { ...base, type: "bar", options: {scales:{y:{beginAtZerro: true}}} }'
	);
	assert.equal(c.complete, true);
	assert.equal(c.binding, 'const');
	assert.deepEqual(reasons(c), []);
	assert.equal(c.value.options.scales.y.beginAtZerro, true);
});

test('unknown function call is partial, not executed', () => {
	const [config] = extractStaticConfigs('const config = {type: "bar", options: makeOptions()}').objects;
	assert.equal(config.complete, false);
	assert.deepEqual(reasons(config), ['CFG_DYNAMIC']);
});

test('literal forms decode to plain values', () => {
	const source =
		'const config = { a: -1, b: null, c: false, d: `t`, e: ("x" as string), f: [1, "y"], "g-h": 2, 3: true };';
	const [object] = extractStaticConfigs(source).objects;
	assert.equal(object.complete, true);
	assert.deepEqual(plain(object.value), { 3: true, a: -1, b: null, c: false, d: 't', e: 'x', f: [1, 'y'], 'g-h': 2 });
});

test('computed keys, array spreads and self references stay partial', () => {
	const config = named('const k = "x"; const config = { [k]: 1, list: [...other], loop: config, method() {} };');
	assert.equal(config.complete, false);
	assert.deepEqual(Object.keys(config.value), ['loop']);
	assert.deepEqual(Object.keys(config.value.loop), []);
	assert.equal(config.diagnostics[0].code, 'CFG_DYNAMIC');
	assert.equal(config.diagnostics[0].line, 1);
});

test('__proto__ keys cannot pollute prototypes', () => {
	const [object] = extractStaticConfigs('const config = { __proto__: { polluted: true } };').objects;
	assert.equal(Object.getPrototypeOf(object.value), null);
	assert.equal({}.polluted, undefined);
});

test('a let or var binding is never resolved to its initializer: it may be reassigned', () => {
	const config = named('let min = 0; min = 5; const config = { foo: min };');
	assert.equal(config.complete, false);
	assert.deepEqual(plain(config.value), {});
});

test('a let or var object is reported with its binding and is never complete', () => {
	const [object] = extractStaticConfigs('let config = { foo: 1 };\nconfig = { foo: 2 };', 'a.ts').objects;
	assert.equal(object.binding, 'let');
	assert.equal(object.complete, false);
	assert.deepEqual(plain(object.value), { foo: 1 });
	assert.deepEqual(object.diagnostics, [
		{
			code: 'CFG_REASSIGNABLE',
			severity: 'info',
			message: 'config is declared with let and may be reassigned; declare it const to analyze it.',
			path: '$.config',
			confidence: 'unknown',
			file: 'a.ts',
			line: 1,
			column: 5
		}
	]);
	assert.equal(named('var config = { foo: 1 };').binding, 'var');
});

test('using bindings cannot be reassigned and count as const', () => {
	assert.equal(named('using config = { foo: 1 };').binding, 'const');
	assert.equal(named('await using config = { foo: 1 };').binding, 'const');
});

test('a name shadowed by a parameter, local, loop or catch binding is not the top-level constant', () => {
	const source = [
		'const min = 0;',
		'function f(min: number) { const config = { foo: min }; return config; }',
		'const g = (min = 1) => { const config = { foo: min }; return config; };',
		'{ const min = 2; const config = { foo: min }; }',
		'for (const min of [3]) { const config = { foo: min }; }',
		'try {} catch (min) { const config = { foo: min }; }',
		'const outer = { foo: min };'
	].join('\n');
	const { objects } = extractStaticConfigs(source);
	const configs = objects.filter((object) => object.name === 'config');
	assert.equal(configs.length, 5);
	for (const config of configs) {
		assert.equal(config.complete, false);
		assert.deepEqual(plain(config.value), {});
	}
	assert.deepEqual(plain(objects.find((object) => object.name === 'outer').value), { foo: 0 });
});

test('a hoisted var, a local enum, class or function anywhere in the enclosing function shadows too (A2)', () => {
	const sources = [
		'const min = 0;\nfunction f(x) { if (x) { var min = 9; } const config = { foo: min }; }',
		'const min = 0;\nfunction f() { for (var min = 1; ; ) {} const config = { foo: min }; }',
		'const min = 0;\nfunction f(x) { switch (x) { case 1: var min = 2; } const config = { foo: min }; }',
		'const min = 0;\nfunction f() { try { var min = 3; } finally {} const config = { foo: min }; }',
		'const min = 0;\nfunction f() { enum min { A } const config = { foo: min }; }',
		'const min = 0;\nfunction f() { const config = { foo: min }; function min() {} }',
		'const min = 0;\nfunction f() { const config = { foo: min }; class min {} }',
		'const min = 0;\nfunction f() { const config = { foo: min }; { let min = 4; } }'
	];
	for (const source of sources) {
		const config = named(source);
		assert.equal(config.complete, false, source);
		assert.deepEqual(plain(config.value), {}, source);
	}
});

test('what a nested function declares stays inside it', () => {
	const config = named('const min = 0;\nfunction f() { function g() { var min = 1; } const config = { foo: min }; }');
	assert.deepEqual(plain(config.value), { foo: 0 });
	assert.equal(config.complete, true);
});

test('unknown array elements become holes, never undefined values', () => {
	const config = named('const config = { data: [1, dyn, 3] };');
	assert.equal(config.complete, false);
	assert.equal(config.value.data.length, 3);
	assert.equal(Object.hasOwn(config.value.data, 1), false);
	assert.deepEqual(Object.keys(config.value.data), ['0', '2']);
});

test('partially known nested objects keep what is known', () => {
	const config = named('const config = { options: { responsive: true, scales: build() } };');
	assert.equal(config.complete, false);
	assert.deepEqual(plain(config.value.options), { responsive: true });
});

test('an unresolved spread drops the keys written before it: they may be overridden (A3)', () => {
	const config = named('const config = { label: 5, type: "bar", ...rest, after: 1 };');
	assert.equal(config.complete, false);
	assert.deepEqual(plain(config.value), { after: 1 });
});

test('spreading an array or a string is incomplete; spreading null or undefined is a no-op', () => {
	const sources = [
		'const config = { ...[1, 2] };',
		'const config = { ..."ab" };',
		'const a = [1]; const config = { ...a };'
	];
	for (const source of sources) {
		const config = named(source);
		assert.equal(config.complete, false, source);
		assert.deepEqual(plain(config.value), {}, source);
	}
	const config = named('const config = { a: 1, ...null, ...undefined };');
	assert.equal(config.complete, true);
	assert.deepEqual(plain(config.value), { a: 1 });
});

test('syntax errors make every object incomplete and are reported with their position', () => {
	const { objects, diagnostics } = extractStaticConfigs(
		"const config = { type: 'bar' data: { datasets: [] } };",
		'b.ts'
	);
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].code, 'CFG_SYNTAX');
	assert.equal(diagnostics[0].file, 'b.ts');
	assert.deepEqual([diagnostics[0].line, diagnostics[0].column], [1, 30]);
	assert.equal(objects[0].complete, false);
	assert.deepEqual(reasons(objects[0]), ['CFG_SYNTAX']);
	assert.deepEqual(
		extractStaticConfigs('const config = { a: [1, 2 };').diagnostics.map((d) => d.code),
		['CFG_SYNTAX']
	);
	assert.deepEqual(extractStaticConfigs('const config = { a: 1 };').diagnostics, []);
});
