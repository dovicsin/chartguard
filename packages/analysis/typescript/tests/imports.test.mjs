import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { analyzeProject } from '../dist/project.js';

/** A project with a tsconfig and the given files; `chart` is analysed as `src/chart.ts`. */
function analyze(t, files, chart, chartName = 'src/chart.ts') {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-imports-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const all = { 'tsconfig.json': '{ "compilerOptions": { "allowJs": true } }', ...files };
	for (const [name, text] of Object.entries(all)) {
		mkdirSync(join(root, name, '..'), { recursive: true });
		writeFileSync(join(root, name), text);
	}
	const config = analyzeProject(chart, join(root, chartName)).objects.find((object) => object.name === 'config');
	return { complete: config.complete, value: JSON.parse(JSON.stringify(config.value)) };
}
const complete = (value) => ({ complete: true, value });
const partial = (value) => ({ complete: false, value });

test('named, renamed and default imports resolve to the constant they finally name', (t) => {
	const files = {
		'src/limits.ts': 'export const min = 1;\nconst hidden = 2;\nexport { hidden as max };',
		'src/theme.ts': 'export default { color: "red" };',
		'src/size.ts': 'const size = 3;\nexport default size;'
	};
	const chart = [
		'import { min, max as upper } from "./limits";',
		'import theme from "./theme";',
		'import size from "./size";',
		'const config = { min, upper, theme, size };'
	].join('\n');
	assert.deepEqual(analyze(t, files, chart), complete({ min: 1, upper: 2, theme: { color: 'red' }, size: 3 }));
});

test('re-export chains, export * and import = require are followed', (t) => {
	const files = {
		'src/base/limits.ts': 'export const min = 1;',
		'src/base/more.ts': 'export const step = 5;',
		'src/base/index.ts': 'export { min as lower } from "./limits";\nexport * from "./more";',
		'src/index.ts': 'export * from "./base";',
		'src/cjs.ts': 'export const flag = true;'
	};
	const chart =
		'import { lower, step } from ".";\nimport cjs = require("./cjs");\nconst config = { lower, step, flag: cjs.flag };';
	assert.deepEqual(analyze(t, files, chart), complete({ lower: 1, step: 5, flag: true }));
});

test('a namespace member resolves; any other property access stays unresolved', (t) => {
	const files = { 'src/limits.ts': 'export const min = 1;\nexport const base = { a: 1 };' };
	const chart = [
		'import * as limits from "./limits";',
		'const local = { a: 2 };',
		'const config = { min: limits.min, missing: limits.nope, member: limits.base.a, local: local.a, whole: limits.base };'
	].join('\n');
	assert.deepEqual(analyze(t, files, chart), partial({ min: 1, whole: { a: 1 } }));
});

test('JavaScript sources are followed like TypeScript ones', (t) => {
	const files = { 'src/limits.js': 'export const min = 1;', 'src/cjs.js': 'exports.max = 2;' };
	const chart = 'import { min } from "./limits.js";\nimport { max } from "./cjs.js";\nconst config = { min, max };';
	assert.deepEqual(analyze(t, files, chart), partial({ min: 1 }));
});

test('only constants and export default / export = expressions of readable project files have a value', (t) => {
	const files = {
		'src/live.ts': 'export let count = 1;',
		'src/make.ts': 'export default function make() { return 1; }',
		'src/equals.ts': 'const v = 1;\nexport = v;',
		'src/broken.ts': 'export const ok = 1;\nexport const bad = { a: 1 b: 2 };',
		'src/types.d.ts': 'export declare const declared: number;',
		'node_modules/lib/package.json': '{ "name": "lib", "types": "index.ts" }',
		'node_modules/lib/index.ts': 'export const fromPackage = 1;'
	};
	const chart = [
		'import { count } from "./live";',
		'import make from "./make";',
		'import equals = require("./equals");',
		'import { ok } from "./broken";',
		'import { declared } from "./types";',
		'import { fromPackage } from "lib";',
		'import { absent } from "./absent";',
		'const config = { count, make, equals, ok, declared, fromPackage, absent, kept: 1 };'
	].join('\n');
	assert.deepEqual(analyze(t, files, chart), partial({ equals: 1, kept: 1 }));
});

test('a cycle across files is unresolved', (t) => {
	const files = {
		'src/a.ts': 'import { b } from "./b";\nexport const a = b;',
		'src/b.ts': 'import { a } from "./a";\nexport const b = a;'
	};
	const chart = 'import { a } from "./a";\nconst config = { a, kept: 1 };';
	assert.deepEqual(analyze(t, files, chart), partial({ kept: 1 }));
});

test('a property is resolved by what the object is, never by its declared type', (t) => {
	const files = { 'src/limits.ts': 'export const min = 1;' };
	// The checker gives `l.min` the symbol of the exported `min`, because `l` is typed `typeof limits`;
	// `l` may be any object of that shape. Only a namespace import itself is the module.
	const chart = [
		'import * as limits from "./limits";',
		'const copy = { ...limits };',
		'function make(l: typeof limits) { const config = { typed: l.min, copied: copy.min, kept: 1 }; }'
	].join('\n');
	assert.deepEqual(analyze(t, files, chart), partial({ kept: 1 }));
});

test('a namespace member read in a function with a direct eval is dynamic', (t) => {
	const files = { 'src/limits.ts': 'export const min = 1;' };
	const chart =
		'import * as limits from "./limits";\nfunction f() { eval(s); const config = { min: limits.min, kept: 1 }; }';
	assert.deepEqual(analyze(t, files, chart), partial({ kept: 1 }));
});
