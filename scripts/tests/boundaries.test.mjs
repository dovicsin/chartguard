import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { moduleReferences } from '../boundaries/imports.mjs';
import { chartRuntimeOf, POLICY } from '../boundaries/policy.mjs';
import { checkImport, checkManifest, declaredDependencies } from '../boundaries/rules.mjs';
import { checkWorkspace } from '../boundaries/workspace.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_DIR = '/repo/packages/config/highcharts';
const FILE = `${PACKAGE_DIR}/src/index.ts`;

function importViolation(name, specifier, dependencies = {}) {
	const manifest = { name, dependencies };
	const rule = POLICY[name];
	return checkImport({
		rule,
		declared: declaredDependencies(manifest),
		packageDir: PACKAGE_DIR,
		file: FILE,
		specifier
	});
}

test('the repository itself respects every boundary', () => assert.deepEqual(checkWorkspace(REPO_ROOT, POLICY), []));

test('a config adapter must not import another chart runtime', () =>
	assert.equal(
		importViolation('@chartguard/config-highcharts', 'echarts'),
		'pulls in the echarts chart runtime "echarts"'
	));

test('a config adapter must not depend on a sibling adapter', () =>
	assert.deepEqual(
		checkManifest(
			{ name: '@chartguard/config-chartjs', dependencies: { '@chartguard/config-echarts': '0.1.0' } },
			POLICY
		),
		['must not depend on @chartguard/config-echarts (dependencies)']
	));

test('core packages must not use Node.js built-ins', () => {
	assert.equal(importViolation('@chartguard/core', 'node:fs'), 'must not import Node.js built-in "node:fs"');
	assert.equal(importViolation('@chartguard/core', 'fs'), 'must not import Node.js built-in "fs"');
	assert.equal(importViolation('@chartguard/cli', 'node:fs'), undefined);
});

test('internal imports go through the package entry point', () =>
	assert.equal(
		importViolation('@chartguard/config-highcharts', '@chartguard/core/dist/result.js', {
			'@chartguard/core': '0.1.0'
		}),
		'deep import "@chartguard/core/dist/result.js"; import the package entry point'
	));

test('relative imports stay inside the package', () => {
	assert.equal(
		importViolation('@chartguard/config-highcharts', '../../../core/src/index.js'),
		'relative import "../../../core/src/index.js" escapes the package'
	);
	assert.equal(importViolation('@chartguard/config-highcharts', './schema.js'), undefined);
});

test('imports must be declared in package.json', () => {
	assert.equal(
		importViolation('@chartguard/config-highcharts', '@chartguard/config-core'),
		'imports undeclared package @chartguard/config-core'
	);
	assert.equal(
		importViolation('@chartguard/config-highcharts', '@chartguard/config-core', { '@chartguard/config-core': '0.1.0' }),
		undefined
	);
});

test('a runtime wrapper may peer-depend on its own library only', () => {
	const runtime = (peerDependencies) =>
		checkManifest({ name: '@chartguard/runtime-echarts', peerDependencies }, POLICY);
	assert.deepEqual(runtime({ echarts: '^6.0.0' }), []);
	assert.deepEqual(runtime({ 'chart.js': '^4.0.0' }), [
		'pulls in the chartjs chart runtime "chart.js" (peerDependencies)'
	]);
	assert.deepEqual(
		checkManifest({ name: '@chartguard/runtime-echarts', dependencies: { echarts: '^6.0.0' } }, POLICY),
		['pulls in the echarts chart runtime "echarts" (dependencies)']
	);
});

test('unknown external dependencies are rejected', () =>
	assert.deepEqual(checkManifest({ name: '@chartguard/core', dependencies: { lodash: '^4.0.0' } }, POLICY), [
		'must not depend on external package lodash (dependencies)'
	]));

test('a package missing from the policy is a violation', () =>
	assert.deepEqual(checkManifest({ name: '@chartguard/new-thing' }, POLICY), [
		'@chartguard/new-thing has no entry in the boundary policy'
	]));

test('chart runtimes and their plugins are recognized', () => {
	assert.equal(chartRuntimeOf('chartjs-plugin-zoom'), 'chartjs');
	assert.equal(chartRuntimeOf('echarts-for-react'), 'echarts');
	assert.equal(chartRuntimeOf('zrender'), 'echarts');
	assert.equal(chartRuntimeOf('@highcharts/dashboards'), 'highcharts');
	assert.equal(chartRuntimeOf('chartist'), undefined);
});

test('every module reference form is extracted without running code', () => {
	const source = [
		"import a from 'a';",
		"import type { B } from 'b';",
		"export { c } from 'c';",
		"export * from 'd';",
		"const e = await import('e');",
		"const f = require('f');",
		"type G = import('g').G;",
		"import h = require('h');",
		'export { local };'
	].join('\n');
	assert.deepEqual(
		moduleReferences(source, 'x.ts').map((reference) => reference.specifier),
		['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
	);
});

test('computed module specifiers are reported, never assumed safe', () => {
	const [reference] = moduleReferences('const m = await import(name);', 'x.ts');
	assert.deepEqual(reference, { specifier: undefined, line: 1 });
	assert.equal(
		importViolation('@chartguard/core', undefined),
		'computed module specifier cannot be verified statically'
	);
});

test('workspace scan reports violations with file and line', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const packageDir = join(root, 'packages', 'config', 'highcharts');
	mkdirSync(join(packageDir, 'src'), { recursive: true });
	writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: '@chartguard/config-highcharts' }));
	writeFileSync(join(packageDir, 'src', 'index.ts'), "export const x = 1;\nimport 'echarts';\n");
	assert.deepEqual(checkWorkspace(root, POLICY), [
		{
			packageName: '@chartguard/config-highcharts',
			file: join('packages', 'config', 'highcharts', 'src', 'index.ts'),
			line: 2,
			message: 'pulls in the echarts chart runtime "echarts"'
		}
	]);
});

test('the playground may use published adapters and the two runtimes, but no Node built-ins or deep imports', () => {
	const rule = POLICY['@chartguard/playground'];
	const declared = new Set(['@chartguard/config-chartjs', 'chart.js', 'echarts', 'date-fns']);
	const check = (specifier) =>
		checkImport({
			rule,
			declared,
			packageDir: '/repo/apps/playground',
			file: '/repo/apps/playground/src/main.ts',
			specifier
		});
	assert.equal(check('@chartguard/config-chartjs'), undefined);
	assert.equal(check('chart.js'), undefined);
	assert.equal(check('echarts'), undefined);
	assert.equal(check('node:fs'), 'must not import Node.js built-in "node:fs"');
	assert.equal(
		check('@chartguard/config-chartjs/dist/walker.js'),
		'deep import "@chartguard/config-chartjs/dist/walker.js"; import the package entry point'
	);
	assert.deepEqual(checkManifest({ name: '@chartguard/playground', dependencies: { highcharts: '13.1.1' } }, POLICY), [
		'pulls in the highcharts chart runtime "highcharts" (dependencies)'
	]);
});
