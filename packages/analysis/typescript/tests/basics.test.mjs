import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';
test('extracts const object and spreads safely', () => {
	const r = extractStaticConfigs(
		'const base = {responsive: true}; const config = { ...base, type: "bar", options: {scales:{y:{beginAtZerro: true}}} }'
	);
	const c = r.objects.find((x) => x.name === 'config');
	assert.equal(c.complete, true);
	assert.equal(c.value.options.scales.y.beginAtZerro, true);
});
test('unknown function call is partial, not executed', () => {
	const r = extractStaticConfigs('const config = {type: "bar", options: makeOptions()}');
	assert.equal(r.objects[0].complete, false);
});

test('literal forms decode to plain values', () => {
	const source =
		'const config = { a: -1, b: null, c: false, d: `t`, e: ("x" as string), f: [1, "y"], "g-h": 2, 3: true };';
	const [object] = extractStaticConfigs(source).objects;
	assert.equal(object.complete, true);
	assert.deepEqual({ ...object.value }, { 3: true, a: -1, b: null, c: false, d: 't', e: 'x', f: [1, 'y'], 'g-h': 2 });
});

test('computed keys, array spreads and self references stay partial', () => {
	const { objects, diagnostics } = extractStaticConfigs(
		'const k = "x"; const config = { [k]: 1, list: [...other], loop: config, method() {} };'
	);
	const config = objects.find((object) => object.name === 'config');
	assert.equal(config.complete, false);
	assert.equal(diagnostics[0].code, 'CFG_DYNAMIC');
	assert.equal(diagnostics[0].line, 1);
});

test('__proto__ keys cannot pollute prototypes', () => {
	const [object] = extractStaticConfigs('const config = { __proto__: { polluted: true } };').objects;
	assert.equal(Object.getPrototypeOf(object.value), null);
	assert.equal({}.polluted, undefined);
});
