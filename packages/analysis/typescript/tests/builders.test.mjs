import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';
import { analyzeProject } from '../dist/project.js';

const json = (value) => JSON.parse(JSON.stringify(value ?? null));
function read(source, name = 'config') {
	const config = extractStaticConfigs(source, 'chart.ts').objects.find((object) => object.name === name);
	return { complete: config.complete, value: json(config.value) };
}
const complete = (value) => ({ complete: true, value });
const partial = (value) => ({ complete: false, value });

test('a builder returns its value: parameters from arguments or defaults, local constants from their initializers', () => {
	const builder =
		'function make(type = "bar", size) {\n\tconst base = { responsive: true };\n\tconst scales = { y: { min: size } };\n\treturn { type, options: { ...base, scales } };\n}\n';
	assert.deepEqual(
		read(`${builder}const config = make("line", 2);`),
		complete({ type: 'line', options: { responsive: true, scales: { y: { min: 2 } } } })
	);
	assert.deepEqual(
		read(`${builder}const config = make();`),
		complete({ type: 'bar', options: { responsive: true, scales: { y: {} } } })
	);
	assert.deepEqual(
		read('const make = (n) => ({ data: [n, n] });\nconst config = make(3);'),
		complete({ data: [3, 3] })
	);
	assert.deepEqual(read('const make = function () { return { a: 1 }; };\nconst config = make();'), complete({ a: 1 }));
	// A default may read an earlier parameter.
	assert.deepEqual(
		read('function make(a, b = a) { return { a, b }; }\nconst config = make(5);'),
		complete({ a: 5, b: 5 })
	);
	// An explicit undefined takes the default, as in JavaScript; null does not.
	assert.deepEqual(
		read('function make(t = "bar") { return { t }; }\nconst config = { u: make(undefined), n: make(null) };'),
		complete({ u: { t: 'bar' }, n: { t: null } })
	);
});

test('an unknown argument stays unknown only where it is used', () => {
	assert.deepEqual(
		read('function make(type, size) { return { type, size }; }\nconst config = make("bar", dyn());'),
		partial({ type: 'bar' })
	);
	assert.deepEqual(
		read('function make(type, unused) { return { type }; }\nconst config = make("bar", dyn());'),
		complete({ type: 'bar' })
	);
});

test('anything that is not a simple builder stays unresolved', () => {
	const unresolved = [
		'function make(x) { if (x) return { a: 1 }; return { a: 2 }; }\nconst config = { v: make(1) };',
		'async function make() { return { a: 1 }; }\nconst config = { v: make() };',
		'function* make() { return { a: 1 }; }\nconst config = { v: make() };',
		'function make(...rest) { return { a: rest }; }\nconst config = { v: make(1) };',
		'function make({ a }) { return { a }; }\nconst config = { v: make({ a: 1 }) };',
		'function make(a) { return { a }; }\nconst config = { v: make(...args) };',
		'function make() { let x = 1; return { x }; }\nconst config = { v: make() };',
		'function make() { return make(); }\nconst config = { v: make() };',
		'let make = () => ({ a: 1 });\nconst config = { v: make() };',
		'const config = { v: unknownFunction() };'
	];
	for (const source of unresolved) assert.deepEqual(read(source), partial({}), source);
});

test("writes to a builder's local constants, from a closure in its body, are left out of what it returns", () => {
	const source =
		'function make() {\n\tconst o = { a: 1, b: 2 };\n\tconst reset = () => { o.a = 0; };\n\treturn o;\n}\nconst config = make();';
	assert.deepEqual(read(source), partial({ b: 2 }));
	// A nested builder sees the parameters of the one it is declared in.
	const nested =
		'function make(type) {\n\tconst part = (n) => ({ type, n });\n\treturn { first: part(1) };\n}\nconst config = make("pie");';
	assert.deepEqual(read(nested), complete({ first: { type: 'pie', n: 1 } }));
});

test("a write into a builder's result may change what the builder shares", () => {
	const source =
		'const theme = { colors: { a: 1, b: 2 } };\nfunction make() { return { palette: theme.colors }; }\nconst result = make();\nresult.palette.a = 9;';
	assert.deepEqual(read(source, 'theme'), partial({}));
	// Replacing the result's own property shares nothing.
	const replaced =
		'const theme = { colors: { a: 1 } };\nfunction make() { return { palette: theme.colors }; }\nconst result = make();\nresult.palette = {};';
	assert.deepEqual(read(replaced, 'theme'), complete({ colors: { a: 1 } }));
	// A builder that returns the shared object itself: replacing a property of the result replaces it there.
	const same =
		'const theme = { colors: { a: 1 } };\nfunction make() { return theme; }\nconst result = make();\nresult.colors = {};';
	assert.deepEqual(read(same, 'theme'), partial({}));
});

test('a builder imported from another project file is followed', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-builders-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const files = {
		'tsconfig.json': '{}',
		'src/make.ts': 'export const makeConfig = (type: string) => ({ type, data: { datasets: [] } });',
		'src/broken.ts': 'export const makeBroken = () => ({ type: "bar" a: 1 });',
		'node_modules/lib/package.json': '{ "name": "lib", "types": "index.ts" }',
		'node_modules/lib/index.ts': 'export const makeLib = () => ({ type: "line" });'
	};
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	const chart =
		'import { Chart } from "chart.js";\nimport { makeConfig } from "./make";\nnew Chart(ctx, makeConfig("pie"));';
	const [use] = analyzeProject(chart, join(root, 'src/chart.ts')).uses;
	assert.deepEqual([use.complete, json(use.value)], [true, { type: 'pie', data: { datasets: [] } }]);
	// Builders in files a value is never read from (A36) are not followed either.
	const other =
		'import { Chart } from "chart.js";\nimport { makeBroken } from "./broken";\nimport { makeLib } from "lib";\nnew Chart(a, makeBroken());\nnew Chart(b, makeLib());';
	assert.deepEqual(
		analyzeProject(other, join(root, 'src/other.ts')).uses.map((entry) => entry.complete),
		[false, false]
	);
});
