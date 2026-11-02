import assert from 'node:assert/strict';
import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { codeFingerprint } from '../dist/fingerprint.js';
import { sourceProject } from './helpers.mjs';

/** The code a cached result was computed by (CG-06-02 part 4d), by content. */
/** A CLI package with a dependency, a dependency of that, maps, and a directory outside. */
function packages(t) {
	const root = sourceProject(t, {
		'cli/package.json': JSON.stringify({
			name: '@chartguard/cli',
			dependencies: { '@chartguard/core': '1', other: '1' }
		}),
		'cli/dist/main.js': 'main',
		'node_modules/@chartguard/core/package.json': JSON.stringify({
			name: '@chartguard/core',
			version: '1.0.0',
			dependencies: { '@chartguard/deep': '1' }
		}),
		'node_modules/@chartguard/deep/package.json': JSON.stringify({ name: '@chartguard/deep' }),
		'node_modules/@chartguard/deep/dist/d.js': 'd',
		'node_modules/@chartguard/core/dist/a.js': 'a',
		'node_modules/@chartguard/core/dist/nested/schema.json': '{}',
		'node_modules/@chartguard/core/dist/a.js.map': 'map',
		'outside/b.js': 'b'
	});
	return { root, cli: join(root, 'cli'), core: join(root, 'node_modules/@chartguard/core') };
}

test('the code fingerprint is by content: not by version, not by maps, not through a directory link', async (t) => {
	const { root, cli, core } = packages(t);
	const first = await codeFingerprint(cli);
	assert.match(first, /^[0-9a-f]{64}$/u);
	assert.equal(await codeFingerprint(cli), first);
	writeFileSync(join(core, 'dist/a.js.map'), 'another map');
	writeFileSync(
		join(core, 'package.json'),
		JSON.stringify({ name: '@chartguard/core', version: '9.9.9', dependencies: { '@chartguard/deep': '1' } })
	);
	assert.equal(await codeFingerprint(cli), first);
	symlinkSync(join(root, 'outside'), join(core, 'dist/linked'), 'dir');
	assert.equal(await codeFingerprint(cli), first);
	writeFileSync(join(core, 'dist/nested/schema.json'), '{"x":1}');
	assert.notEqual(await codeFingerprint(cli), first);
});

test('the code fingerprint covers a dependency of a dependency and the CLI itself; a package without a manifest is a defect', async (t) => {
	const { root, cli } = packages(t);
	const first = await codeFingerprint(cli);
	writeFileSync(join(root, 'node_modules/@chartguard/deep/dist/d.js'), 'd 2');
	const deep = await codeFingerprint(cli);
	assert.notEqual(deep, first);
	writeFileSync(join(cli, 'dist/main.js'), 'main 2');
	assert.notEqual(await codeFingerprint(cli), deep);
	await assert.rejects(codeFingerprint(join(root, 'outside')));
});

test('the walk is bounded over all packages together: every entry counts, also directories and maps', async (t) => {
	const { cli } = packages(t);
	// main.js; a.js, a.js.map, nested, nested/schema.json; d.js: six entries, at most four in one package.
	assert.match(await codeFingerprint(cli, 6), /^[0-9a-f]{64}$/u);
	await assert.rejects(codeFingerprint(cli, 5), /more files under the ChartGuard packages than a fingerprint reads/u);
	await assert.rejects(codeFingerprint(cli, 3), /more files/u);
});
