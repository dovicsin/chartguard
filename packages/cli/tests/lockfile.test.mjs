import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { lockedVersion } from '../dist/lockfile.js';
import { run, sourceProject } from './helpers.mjs';

/** The library version from the lockfile when nothing is installed (CG-06-02 part 4a). */
const CONFIG = JSON.stringify({ title: { text: 'x' } });

test('npm: a workspace entry, else the hoisted one; v1 dependencies', async (t) => {
	const root = sourceProject(t, {
		'package-lock.json': JSON.stringify({
			lockfileVersion: 3,
			packages: {
				'': { workspaces: ['apps/web'] },
				'node_modules/echarts': { version: '6.1.0' },
				'apps/web/node_modules/echarts': { version: '5.6.0' }
			}
		}),
		'apps/web/package.json': '{}',
		'apps/web/chart.json': CONFIG,
		'apps/other/chart.json': CONFIG
	});
	assert.deepEqual(await lockedVersion('echarts', join(root, 'apps/web/chart.json')), {
		version: '5.6.0',
		lockfile: join(root, 'package-lock.json')
	});
	assert.equal((await lockedVersion('echarts', join(root, 'apps/other/chart.json'))).version, '6.1.0');
	const v1 = sourceProject(t, {
		'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: { 'chart.js': { version: '4.4.1' } } }),
		'c.json': CONFIG
	});
	assert.equal((await lockedVersion('chart.js', join(v1, 'c.json'))).version, '4.4.1');
	// Not in the lockfile: no claim.
	assert.equal(await lockedVersion('highcharts', join(v1, 'c.json')), undefined);
});

test("pnpm: the file's importer, any dependency kind, a peer suffix removed", async (t) => {
	const root = sourceProject(t, {
		'pnpm-lock.yaml': [
			"lockfileVersion: '9.0'",
			'',
			'importers:',
			'',
			'  .:',
			'    dependencies:',
			'      echarts:',
			'        specifier: ^6.0.0',
			'        version: 6.1.0',
			'',
			'  packages/charts:',
			'    devDependencies:',
			'      chart.js:',
			'        specifier: ^4.5.0',
			'        version: 4.5.1(date-fns@4.1.0)',
			'      highcharts:',
			'        specifier: link:../highcharts',
			'        version: link:../highcharts',
			''
		].join('\n'),
		'packages/charts/package.json': '{}',
		'packages/charts/c.json': CONFIG,
		'c.json': CONFIG
	});
	assert.equal((await lockedVersion('chart.js', join(root, 'packages/charts/c.json'))).version, '4.5.1');
	assert.equal((await lockedVersion('echarts', join(root, 'c.json'))).version, '6.1.0');
	// A link is not a version: the user says which.
	await assert.rejects(
		lockedVersion('highcharts', join(root, 'packages/charts/c.json')),
		/link:\.\.\/highcharts is not an exact version/u
	);
});

test('Yarn: the entry of the range package.json declares, classic and Berry; two candidates is no decision', async (t) => {
	const classic = sourceProject(t, {
		'package.json': JSON.stringify({ dependencies: { echarts: '^6.0.0' } }),
		'yarn.lock': [
			'# yarn lockfile v1',
			'',
			'echarts@^5.0.0:',
			'  version "5.6.0"',
			'',
			'echarts@^6.0.0, echarts@^6.1.0:',
			'  version "6.1.0"',
			'  resolved "https://registry.yarnpkg.com/echarts/-/echarts-6.1.0.tgz"',
			''
		].join('\n'),
		'c.json': CONFIG
	});
	assert.equal((await lockedVersion('echarts', join(classic, 'c.json'))).version, '6.1.0');
	const berry = sourceProject(t, {
		'package.json': JSON.stringify({ devDependencies: { 'chart.js': '^4.5.0' } }),
		'yarn.lock': [
			'__metadata:',
			'  version: 8',
			'',
			'"chart.js@npm:^4.5.0":',
			'  version: 4.5.1',
			'  resolution: "chart.js@npm:4.5.1"',
			''
		].join('\n'),
		'c.json': CONFIG
	});
	assert.equal((await lockedVersion('chart.js', join(berry, 'c.json'))).version, '4.5.1');
	const undeclared = sourceProject(t, {
		'package.json': '{}',
		'yarn.lock': ['echarts@^5.0.0:', '  version "5.6.0"', '', 'echarts@^6.0.0:', '  version "6.1.0"', ''].join('\n'),
		'c.json': CONFIG
	});
	await assert.rejects(lockedVersion('echarts', join(undeclared, 'c.json')), /yarn\.lock holds 2 versions of echarts/u);
});

test('an unreadable lockfile is an input error, never a guess', async (t) => {
	const root = sourceProject(t, { 'package-lock.json': '{ not json', 'c.json': CONFIG });
	await assert.rejects(lockedVersion('echarts', join(root, 'c.json')), /package-lock\.json cannot be read/u);
});

test('validate --library-version auto: node_modules first, then the lockfile; the text names where it came from', async (t) => {
	const root = sourceProject(t, {
		'package-lock.json': JSON.stringify({
			lockfileVersion: 3,
			packages: { 'node_modules/echarts': { version: '5.6.0' } }
		}),
		'c.json': CONFIG
	});
	const locked = await run([
		'validate',
		'--library',
		'echarts',
		'--file',
		join(root, 'c.json'),
		'--library-version',
		'auto'
	]);
	assert.match(locked.out, /version 5\.6\.0 from .*package-lock\.json/u);
	assert.match(locked.out, /5\.6\.0/u);
	const installed = sourceProject(t, {
		'node_modules/echarts/package.json': JSON.stringify({ name: 'echarts', version: '6.1.0' }),
		'package-lock.json': JSON.stringify({
			lockfileVersion: 3,
			packages: { 'node_modules/echarts': { version: '5.6.0' } }
		}),
		'c.json': CONFIG
	});
	const fromInstall = await run([
		'validate',
		'--library',
		'echarts',
		'--file',
		join(installed, 'c.json'),
		'--library-version',
		'auto',
		'--format',
		'sarif'
	]);
	assert.deepEqual(
		[
			JSON.parse(fromInstall.out).runs[0].properties.libraryVersion,
			JSON.parse(fromInstall.out).runs[0].properties.libraryVersionSource
		],
		['6.1.0', 'node_modules']
	);
});
