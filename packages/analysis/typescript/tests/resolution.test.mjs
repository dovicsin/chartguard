import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';

const named = (source, name = 'config', filename) =>
	extractStaticConfigs(source, filename).objects.find((object) => object.name === name);
const plain = (value) => ({ ...value });
const resolved = (source) => {
	const config = named(source);
	return { complete: config.complete, value: plain(config.value) };
};
const UNRESOLVED = { complete: false, value: {} };

test('scoping is exact: a name declared only in a sibling block is not a shadow', () => {
	assert.deepEqual(resolved('const min = 0;\nfunction f() { { let min = 4; } const config = { foo: min }; }'), {
		complete: true,
		value: { foo: 0 }
	});
	assert.deepEqual(resolved('const min = 0;\nif (x) { const min = 1; }\nconst config = { foo: min };'), {
		complete: true,
		value: { foo: 0 }
	});
});

test('a with statement makes every name in its body dynamic: the object may supply it', () => {
	assert.deepEqual(resolved('const min = 0;\nwith (o) { const config = { foo: min }; }'), UNRESOLVED);
	assert.deepEqual(resolved('const min = 0;\nwith (o) { function f() { const config = { foo: min }; } }'), UNRESOLVED);
	// The object expression itself is evaluated outside the with body.
	assert.deepEqual(resolved('const min = 0;\nconst config = { foo: min };\nwith (config) {}'), {
		complete: true,
		value: { foo: 0 }
	});
});

test('a direct eval in an enclosing function may declare any name there', () => {
	assert.deepEqual(
		resolved('const min = 0;\nfunction f() { eval("var min = 1"); const config = { foo: min }; }'),
		UNRESOLVED
	);
	assert.deepEqual(
		resolved('const min = 0;\nfunction f() { const g = () => { const config = { foo: min }; }; eval(s); }'),
		UNRESOLVED
	);
	// An indirect eval runs in the global scope, and a nested function's eval stays in that function.
	for (const source of [
		'const min = 0;\nfunction f() { (0, eval)("var min = 1"); const config = { foo: min }; }',
		'const min = 0;\nfunction f() { function g() { eval(s); } const config = { foo: min }; }'
	])
		assert.deepEqual(resolved(source), { complete: true, value: { foo: 0 } }, source);
});

test('shorthand properties resolve to the value they name, exactly like the longhand', () => {
	assert.deepEqual(resolved('const min = 0;\nconst config = { min };'), { complete: true, value: { min: 0 } });
	assert.deepEqual(resolved('const min = 0;\nfunction f(min) { const config = { min }; }'), UNRESOLVED);
});

test('undefined is the global only when nothing shadows it', () => {
	assert.deepEqual(resolved('const config = { a: undefined, b: 1 };'), {
		complete: true,
		value: { a: undefined, b: 1 }
	});
	assert.deepEqual(resolved('function f(undefined) { const config = { a: undefined }; }'), UNRESOLVED);
});

test('imported names, cycles between constants and non-const bindings stay unresolved', () => {
	assert.deepEqual(resolved('import { min } from "./limits";\nconst config = { foo: min };'), UNRESOLVED);
	assert.deepEqual(resolved('import min from "./limits";\nconst config = { foo: min };'), UNRESOLVED);
	assert.deepEqual(resolved('const a = b;\nconst b = a;\nconst config = { foo: a };'), UNRESOLVED);
	assert.deepEqual(resolved('const config = { foo: f };\nfunction f() {}'), UNRESOLVED);
});

test('JavaScript files and every script kind are read by their extension', () => {
	for (const filename of ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.mts', 'a.cts', 'a.tsx']) {
		const config = named('const min = 1;\nconst config = { foo: min };', 'config', filename);
		assert.deepEqual([config.complete, plain(config.value)], [true, { foo: 1 }], filename);
	}
	const jsx = named('const config = { label: <b>x</b>, size: 2 };', 'config', 'a.tsx');
	assert.deepEqual([jsx.complete, plain(jsx.value)], [false, { size: 2 }]);
});

test('a file without a script extension is read as TypeScript and reported under its own name', () => {
	const { objects, diagnostics } = extractStaticConfigs('const min = 1;\nconst config = { foo: min };', 'chart.vue');
	assert.deepEqual([objects[0].complete, plain(objects[0].value)], [true, { foo: 1 }]);
	assert.deepEqual(diagnostics, []);
	const broken = extractStaticConfigs('const config = { a: 1 b: 2 };', 'notes.txt');
	assert.deepEqual(
		broken.diagnostics.map((d) => [d.code, d.file]),
		[['CFG_SYNTAX', 'notes.txt']]
	);
});

test('every name in a function with a direct eval is dynamic, not only the first one looked up', () => {
	assert.deepEqual(
		resolved('const min = 0;\nconst max = 9;\nfunction f() { eval(s); const config = { foo: min, bar: max }; }'),
		UNRESOLVED
	);
});
