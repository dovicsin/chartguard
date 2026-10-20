import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';

const json = (value) => JSON.parse(JSON.stringify(value ?? null));
function read(source, name = 'config') {
	const config = extractStaticConfigs(source, 'chart.ts').objects.find((object) => object.name === name);
	return { complete: config.complete, value: json(config.value) };
}
const complete = (value) => ({ complete: true, value });
const partial = (value) => ({ complete: false, value });
const TWO =
	'const a = { type: "bar", options: { color: "red", size: 2 }, data: [1, 2] };\nconst b = { type: "bar", options: { color: "blue", size: 2 }, data: [1, 3] };\n';

test('a decidable condition picks its branch', () => {
	for (const condition of ['true', '1', '"x"', 'a', '[]', '!false', '"bar" === "bar"', '2 !== 3', 'kind === "bar"'])
		assert.deepEqual(
			read(
				`${TWO}const kind = "bar";\nconst config = { picked: ${condition} ? kind : 0, v: ${condition} ? "yes" : "no" };`
			),
			complete({ picked: 'bar', v: 'yes' }),
			condition
		);
	for (const condition of ['false', '0', '""', 'null', 'undefined', '!a', 'kind !== "bar"'])
		assert.deepEqual(
			read(`const kind = "bar";\nconst a = {};\nconst config = { v: ${condition} ? "yes" : "no" };`),
			complete({ v: 'no' }),
			condition
		);
});

test('an undecidable condition keeps only what both branches agree on', () => {
	assert.deepEqual(
		read(`${TWO}const config = dark ? a : b;`),
		partial({ type: 'bar', options: { size: 2 }, data: [1, null] })
	);
	assert.deepEqual(
		read(`${TWO}const config = dark ? a : a;`),
		complete({ type: 'bar', options: { color: 'red', size: 2 }, data: [1, 2] })
	);
	// Keys present on one side only, values of different kinds, arrays of different lengths: unknown.
	assert.deepEqual(
		read('const config = x ? { a: 1, b: { c: 1 }, l: [1] } : { a: 1, b: 2, l: [1, 2], d: 4 };'),
		partial({ a: 1 })
	);
	const hole = extractStaticConfigs(`${TWO}const config = dark ? a : b;`, 'chart.ts').objects.find(
		(object) => object.name === 'config'
	).value.data;
	assert.equal(Object.hasOwn(hole, 1), false);
});

test('??, || and && follow JavaScript when the left side is known, and merge otherwise', () => {
	assert.deepEqual(
		read('const config = { a: null ?? 1, b: 0 ?? 1, c: 0 || 2, d: "x" || 2, e: 0 && 3, f: "x" && 3, g: {} ?? 1 };'),
		complete({ a: 1, b: 0, c: 2, d: 'x', e: 0, f: 3, g: {} })
	);
	assert.deepEqual(read('const config = { a: user ?? 1, b: user || { x: 1 } };'), partial({}));
	assert.deepEqual(read('const config = { a: maybe ? 1 : 1, b: maybe && 1 };'), partial({ a: 1 }));
});

test('a write through a choice may change either side', () => {
	const value = (source, name) => read(source, name).value;
	const source = `${TWO}const chosen = dark ? a : b;\nchosen.options.color = "x";`;
	assert.deepEqual([value(source, 'a').options, value(source, 'b').options], [{ size: 2 }, { size: 2 }]);
	const fallback = `${TWO}const chosen = a ?? b;\nchosen.options.size = 9;`;
	assert.deepEqual([value(fallback, 'a').options, value(fallback, 'b').options], [{ color: 'red' }, { color: 'blue' }]);
});

test('an object is truthy even when its contents are not all known', () => {
	assert.deepEqual(
		read('const o = { x: dyn() };\nconst config = { v: o ? "yes" : "no", w: !o };'),
		complete({ v: 'yes', w: false })
	);
});
