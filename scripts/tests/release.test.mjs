import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { manifestsUnder } from '../../tools/shared/workspace.mjs';

/** CG-00-06: independently versioned packages, published public under one scope, from this repository. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const manifests = () => [...manifestsUnder(join(ROOT, 'packages')), ...manifestsUnder(join(ROOT, 'apps'))];

test('every published package is scoped, public, licensed and points at its directory in this repository', () => {
	const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	for (const { path, manifest } of manifests().filter((entry) => entry.manifest.private !== true)) {
		const directory = relative(ROOT, path).split(sep).join('/');
		assert.match(manifest.name, /^@chartguard\/[a-z0-9-]+$/, directory);
		assert.deepEqual(manifest.publishConfig, { access: 'public' }, directory);
		assert.equal(manifest.license, 'MIT', directory);
		assert.deepEqual(
			manifest.repository,
			{ type: 'git', url: 'git+https://github.com/dovicsin/chartguard.git', directory },
			directory
		);
		assert.ok(manifest.files.includes('README.md'), directory);
		// Workspace packages depend on each other at their exact current versions; Changesets bumps both together.
		for (const [dependency, range] of Object.entries(manifest.dependencies ?? {}))
			if (dependency.startsWith('@chartguard/')) {
				const target = manifests().find((other) => other.manifest.name === dependency);
				assert.equal(range, target?.manifest.version, `${directory}: ${dependency}`);
			}
	}
	assert.ok(root.private, 'the workspace root is never published');
});

test('Changesets versions every package on its own and publishes them public', () => {
	const config = JSON.parse(readFileSync(join(ROOT, '.changeset', 'config.json'), 'utf8'));
	assert.deepEqual(
		[config.fixed, config.linked, config.access, config.baseBranch, config.commit],
		[[], [], 'public', 'main', false]
	);
});
