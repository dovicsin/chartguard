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
const partial = (value) => ({ complete: false, value });
const BASE =
	'const config = { type: "bar", options: { color: "red", size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } };\n';

test('an assigned, updated or deleted path is unknown; the rest is kept', () => {
	assert.deepEqual(
		read(`${BASE}config.options.color = "white";`),
		partial({ type: 'bar', options: { size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}config.options.size += 1;\nconfig.type ??= "line";`),
		partial({ options: { color: 'red' }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}config.options.size++;\ndelete config.type;`),
		partial({ options: { color: 'red' }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
});

test('a method call may change its receiver; an array element written by index becomes a hole', () => {
	assert.deepEqual(
		read(`${BASE}config.data.datasets.push({ a: 3 });`),
		partial({ type: 'bar', options: { color: 'red', size: 2 }, data: {} })
	);
	const inner = extractStaticConfigs(`${BASE}config.data.datasets[0].a = 9;`, 'chart.ts').objects[0];
	assert.deepEqual([inner.complete, json(inner.value.data.datasets)], [false, [{}, { a: 2 }]]);
	const hole = extractStaticConfigs(`${BASE}config.data.datasets[0] = 9;`, 'chart.ts').objects[0];
	assert.deepEqual(json(hole.value.data.datasets), [null, { a: 2 }]);
	assert.equal(Object.hasOwn(hole.value.data.datasets, 0), false);
	assert.equal(hole.value.data.datasets.length, 2);
	assert.deepEqual(read(`${BASE}config.reset();`), partial({}));
});

test('a computed key, Object.assign and Reflect.set write everything below them', () => {
	assert.deepEqual(
		read(`${BASE}config.options[key] = 1;`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}config["options"].color = "x";`),
		partial({ type: 'bar', options: { size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}Object.assign(config.options, theme);`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(read(`${BASE}Reflect.set(config, "type", "line");`), partial({}));
});

test('a write to a key that did not exist, or in code that may never run, still makes the value incomplete', () => {
	assert.deepEqual(read(`${BASE}config.plugins = [];`).complete, false);
	// Through a key that does not exist, or through a value that is not an object: nothing to leave out.
	const kept = { type: 'bar', options: { color: 'red', size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } };
	assert.deepEqual(read(`${BASE}config.plugins.legend = {};`), partial(kept));
	assert.deepEqual(read(`${BASE}config.type.length = 0;`), partial(kept));
	assert.deepEqual(
		read(`${BASE}function dark() { if (x) config.options.color = "white"; }`),
		partial({ type: 'bar', options: { size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
});

test('reads are not writes: a chart use, a spread or a property read leaves the value complete', () => {
	const source = `import { Chart } from "chart.js";\n${BASE}const copy = { ...config };\nconst t = config.type;\nnew Chart(ctx, config);`;
	assert.equal(read(source).complete, true);
});

test('a constant that spreads or embeds a written one inherits the unknown path', () => {
	const source =
		'const base = { color: "red", size: 2 };\nbase.color = "white";\nconst config = { options: base, copy: { ...base } };';
	assert.deepEqual(read(source), partial({ options: { size: 2 }, copy: { size: 2 } }));
});

test('each write of the object itself is noted with its path and place', () => {
	const config = extractStaticConfigs(
		`${BASE}config.options.color = "white";\nconfig.data.datasets.push(1);`,
		'chart.ts'
	).objects[0];
	assert.deepEqual(
		config.diagnostics.map((d) => [d.code, d.path, d.line]),
		[
			['CFG_MUTATED', '$.options.color', 2],
			['CFG_MUTATED', '$.data.datasets', 3]
		]
	);
	assert.match(config.diagnostics[0].message, /chart\.ts:2/);
	assert.deepEqual(extractStaticConfigs(BASE, 'chart.ts').objects[0].diagnostics, []);
});

test('writes in other files are found through imports and namespace members', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-writes-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const files = {
		'tsconfig.json': '{}',
		'src/theme.ts': 'export const theme = { color: "red", size: 2 };\nexport const other = { a: 1, b: 2 };',
		'src/dark.ts':
			'import { theme } from "./theme";\nimport * as all from "./theme";\ntheme.color = "white";\nall.other.a = 3;'
	};
	for (const [name, text] of Object.entries(files)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	const chart = 'import { theme, other } from "./theme";\nimport "./dark";\nexport const config = { theme, other };';
	const [config] = analyzeProject(chart, join(root, 'src/chart.ts')).objects;
	assert.deepEqual([config.complete, json(config.value)], [false, { theme: { size: 2 }, other: { b: 2 } }]);
});

test('a write through a const alias or an embedding reaches the object it shares', () => {
	assert.deepEqual(
		read(`${BASE}const opts = config.options;\nopts.color = "white";`),
		partial({ type: 'bar', options: { size: 2 }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}const outer = { inner: { opts: config.options } };\nouter.inner.opts.size = 3;`),
		partial({ type: 'bar', options: { color: 'red' }, data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(
		read(`${BASE}const sets = config.data.datasets;\nsets.push({});`),
		partial({ type: 'bar', options: { color: 'red', size: 2 }, data: {} })
	);
	// Replacing the alias's own property changes the alias, not the object it shared.
	assert.equal(read(`${BASE}const outer = { opts: config.options };\nouter.opts = {};`).complete, true);
});

test('passing an object to a call that is not a chart use may change it; known pure globals do not', () => {
	assert.deepEqual(read(`${BASE}applyTheme(config);`), partial({}));
	assert.deepEqual(
		read(`${BASE}apply(config.options);`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }, { a: 2 }] } })
	);
	assert.deepEqual(read(`${BASE}apply({ o: config.options, list: [config.data] });`), partial({ type: 'bar' }));
	assert.deepEqual(read(`${BASE}new Builder(config.options);`).value.options, undefined);
	const pure = `${BASE}console.log(config);\nJSON.stringify(config.options);\nObject.keys(config);\nstructuredClone(config);`;
	assert.equal(read(pure).complete, true);
	assert.equal(read(`const console = { log() {} };\n${BASE}console.log(config);`).complete, false);
	assert.equal(read(`import { Chart } from "chart.js";\n${BASE}new Chart(ctx, config);`).complete, true);
});

test('a write through an alias reaches every object the aliased place may come from', () => {
	const two = 'const a = { opts: { color: "red", size: 2 } };\nconst b = { opts: { color: "blue", size: 3 } };\n';
	const value = (source, name) => read(source, name).value;
	// A later spread may override the explicit property; an earlier one may not.
	const later = `${two}const outer = { opts: a.opts, ...b };\nouter.opts.color = "x";`;
	assert.deepEqual([value(later, 'a'), value(later, 'b')], [{ opts: { size: 2 } }, { opts: { size: 3 } }]);
	const earlier = `${two}const outer = { ...b, opts: a.opts };\nouter.opts.color = "x";`;
	assert.deepEqual(
		[value(earlier, 'a'), value(earlier, 'b')],
		[{ opts: { size: 2 } }, { opts: { color: 'blue', size: 3 } }]
	);
	// After a spread, an index may name any element.
	const list = `${two}const items = [...more, a.opts, b.opts];\nitems[1].color = "x";`;
	assert.deepEqual([value(list, 'a'), value(list, 'b')], [{ opts: { size: 2 } }, { opts: { size: 3 } }]);
	const exact = `${two}const items = [a.opts, b.opts];\nitems[1].color = "x";`;
	assert.deepEqual(
		[value(exact, 'a'), value(exact, 'b')],
		[{ opts: { color: 'red', size: 2 } }, { opts: { size: 3 } }]
	);
});
