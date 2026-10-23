import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { extractStaticConfigs } from '../dist/index.js';
import { analyzeProject } from '../dist/project.js';

/**
 * Writes the syntax hides (A37, A39, A9, A34, A36, A1): a write is a write however the target is
 * spelled, and what code may do that cannot be read makes the value unknown, never complete.
 */
const json = (value) => JSON.parse(JSON.stringify(value ?? null));
function read(source, name = 'config') {
	const config = extractStaticConfigs(source, 'chart.ts').objects.find((object) => object.name === name);
	return { complete: config.complete, value: json(config.value) };
}
const partial = (value) => ({ complete: false, value });
const BASE =
	'const config = { type: "bar", options: { responsive: "yes", size: 2 }, data: { datasets: [{ a: 1 }] } };\n';
const WITHOUT_RESPONSIVE = { type: 'bar', options: { size: 2 }, data: { datasets: [{ a: 1 }] } };

test('a write through a cast, a type assertion, satisfies or a non-null assertion is a write', () => {
	for (const target of [
		'(config as any)',
		'(<any>config)',
		'(config satisfies object as any)',
		'config!',
		'((config as any))!'
	])
		assert.deepEqual(read(`${BASE}${target}.options.responsive = true;`), partial(WITHOUT_RESPONSIVE), target);
	assert.deepEqual(read(`${BASE}(config.options as any).responsive = true;`), partial(WITHOUT_RESPONSIVE));
	assert.deepEqual(
		read(`${BASE}(config as any).data.datasets.push({});`),
		partial({ type: 'bar', options: { responsive: 'yes', size: 2 }, data: {} })
	);
	assert.deepEqual(
		read(`${BASE}Object.assign(config.options as object, theme);`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }] } })
	);
	assert.deepEqual(read(`${BASE}apply(config as any);`), partial({}));
});

test('a destructured binding aliases the place it was read from; rebinding the name writes nothing', () => {
	assert.deepEqual(read(`${BASE}const { options } = config;\noptions.responsive = true;`), partial(WITHOUT_RESPONSIVE));
	assert.deepEqual(
		read(`${BASE}const { options: opts } = config;\nopts.responsive = true;`),
		partial(WITHOUT_RESPONSIVE)
	);
	assert.deepEqual(
		read(`${BASE}const { data: { datasets: [first] } } = config;\nfirst.a = 2;`),
		partial({ type: 'bar', options: { responsive: 'yes', size: 2 }, data: { datasets: [{}] } })
	);
	assert.deepEqual(read(`${BASE}const { ...rest } = config;\nrest.options.responsive = true;`).complete, false);
	assert.deepEqual(read(`${BASE}const [x] = [config.options];\nx.responsive = true;`).complete, false);
	assert.deepEqual(
		read(`${BASE}function f() { let { options } = config; options.responsive = true; }`),
		partial(WITHOUT_RESPONSIVE)
	);
	// A computed binding name may read any key.
	assert.deepEqual(read(`${BASE}const { [key]: any } = config;\nany.responsive = true;`).complete, false);
	// Rebinding the destructured name replaces the local binding, not the object.
	assert.equal(read(`${BASE}let { options } = config;\noptions = {};`).complete, true);
});

test('a for-of variable aliases every element of what it iterates', () => {
	assert.deepEqual(
		read(`${BASE}for (const set of config.data.datasets) set.a = 2;`),
		partial({ type: 'bar', options: { responsive: 'yes', size: 2 }, data: {} })
	);
	assert.equal(read(`${BASE}for (const { a } of config.data.datasets) a.b = 2;`).complete, false);
	assert.equal(read(`${BASE}for (let set of config.data.datasets) set = {};`).complete, true);
	// A for-in variable holds a key, not an element.
	assert.equal(read(`${BASE}for (const key in config.options) key.length;`).complete, true);
});

test('an object or array handed to an unknown call hands over every constant it embeds', () => {
	assert.deepEqual(
		read(`${BASE}const outer = { opts: config.options };\napplyTheme(outer);`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }] } })
	);
	assert.deepEqual(
		read(`${BASE}const outer = { deep: [{ opts: config.options }] };\nouter.deep.push(1);`).complete,
		false
	);
	assert.deepEqual(read(`${BASE}const list = [config.data];\nlist.forEach(touch);`).value.data, undefined);
	// Replacing the outer object's own property still changes only the outer object.
	assert.equal(read(`${BASE}const outer = { opts: config.options };\nouter.opts = {};`).complete, true);
});

test('a direct eval may write any constant it can see; a with body may write any property of its object', () => {
	assert.deepEqual(read(`${BASE}eval("config.options.responsive = true");`), partial({}));
	assert.deepEqual(read(`${BASE}function f(code) { eval(code); }`), partial({}));
	// Indirect eval runs in the global scope: module constants are out of its reach.
	assert.equal(read(`${BASE}(0, eval)("x = 1");`).complete, true);
	assert.deepEqual(
		read(`${BASE}with (config.options) { responsive = true; }`),
		partial({ type: 'bar', data: { datasets: [{ a: 1 }] } })
	);
});

test('a function declaration that is assigned to anywhere is not a builder', () => {
	const builder = 'function make() { return { type: "bar", options: { responsive: "yes" } }; }\n';
	const config = (source) =>
		extractStaticConfigs(source, 'chart.ts').objects.find((object) => object.name === 'config');
	assert.deepEqual(read(`${builder}const config = make();`), {
		complete: true,
		value: { type: 'bar', options: { responsive: 'yes' } }
	});
	// Its body is not what the call returns: the call is an unknown value, not the builder's literal.
	for (const later of [
		'make = () => ({ type: "line" });\nconst config = make();',
		'const config = make();\nif (x) make = other;',
		'const config = make();\neval(code);'
	])
		assert.equal(config(`${builder}${later}`), undefined, later);
});

test('a getter, a method or a computed key may replace a key written before it: that key is no longer known', () => {
	assert.deepEqual(
		read('const config = { options: { responsive: "yes" }, get options() { return {}; } };'),
		partial({})
	);
	assert.deepEqual(
		read('const config = { type: "bar", options: { responsive: "yes" }, options() {} };'),
		partial({ type: 'bar' })
	);
	assert.deepEqual(read('const config = { type: "bar", options: { responsive: "yes" }, [key]: {} };'), partial({}));
	// A key written after it is known again.
	assert.deepEqual(read('const config = { [key]: {}, type: "bar" };'), partial({ type: 'bar' }));
	assert.deepEqual(
		read('const config = { get options() { return {}; }, options: { a: 1 } };'),
		partial({ options: { a: 1 } })
	);
	// An accessor of another name leaves the earlier keys known.
	assert.deepEqual(read('const config = { type: "bar", get extra() { return 1; } };'), partial({ type: 'bar' }));
});

function project(t, files) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-hidden-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, text] of Object.entries({ 'tsconfig.json': '{}', ...files })) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	return root;
}

test('a file with syntax errors may write every constant it imports: nothing it does is known', (t) => {
	const root = project(t, {
		'src/theme.ts': 'export const theme = { color: "red", size: 2 };\nexport const other = { a: 1 };',
		'src/broken.ts': 'import { theme } from "./theme";\ntheme.color = "white";\nconst x = {;'
	});
	const chart = 'import { theme, other } from "./theme";\nimport "./broken";\nexport const config = { theme, other };';
	const [config] = analyzeProject(chart, join(root, 'src/chart.ts')).objects;
	// The written constant's contents are unknown (`{}`); the one the broken file does not import is kept.
	assert.deepEqual([config.complete, json(config.value)], [false, { theme: {}, other: { a: 1 } }]);
});

test('a computed member of a namespace import may be any export: every export is written', (t) => {
	const root = project(t, {
		'src/theme.ts': 'export const theme = { color: "red" };\nexport const other = { a: 1 };',
		'src/dark.ts': 'import * as all from "./theme";\nall[name].color = "white";'
	});
	const chart = 'import { theme, other } from "./theme";\nimport "./dark";\nexport const config = { theme, other };';
	const [config] = analyzeProject(chart, join(root, 'src/chart.ts')).objects;
	assert.deepEqual([config.complete, json(config.value)], [false, { theme: {}, other: {} }]);
});
