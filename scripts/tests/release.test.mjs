import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
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

/** The packages a changeset's front matter bumps (`'@chartguard/core': minor`). */
function bumpedBy(text) {
	const front = /^---\r?\n(?<body>[\s\S]*?)\r?\n---/u.exec(text)?.groups?.body ?? '';
	return front
		.split(/\r?\n/u)
		.map((line) => /^\s*['"]?(?<name>[^'":]+)['"]?\s*:\s*(?:major|minor|patch)\s*$/u.exec(line)?.groups?.name)
		.filter((name) => name !== undefined);
}

/**
 * The generator's version is written into every artifact it builds (CG-07-06), so a release of
 * `@chartguard/schema-generator` changes the committed schemas, which the adapters publish: they
 * are released with it.
 */
const SHIPS_GENERATED = ['@chartguard/config-chartjs', '@chartguard/config-echarts'];
const missingSchemaBumps = (text) =>
	bumpedBy(text).includes('@chartguard/schema-generator')
		? SHIPS_GENERATED.filter((name) => !bumpedBy(text).includes(name))
		: [];

test('a changeset releasing the generator releases the adapters whose schemas it writes its version into', () => {
	const directory = join(ROOT, '.changeset');
	for (const file of readdirSync(directory).filter((name) => name.endsWith('.md') && name !== 'README.md'))
		assert.deepEqual(missingSchemaBumps(readFileSync(join(directory, file), 'utf8')), [], file);
	const generatorOnly = "---\n'@chartguard/schema-generator': minor\n---\n\nReads more.\n";
	assert.deepEqual(missingSchemaBumps(generatorOnly), SHIPS_GENERATED);
	const together = `---\n"@chartguard/schema-generator": minor\n"@chartguard/config-chartjs": patch\n'@chartguard/config-echarts': patch\n---\n`;
	assert.deepEqual(missingSchemaBumps(together), []);
	assert.deepEqual(missingSchemaBumps("---\n'@chartguard/core': patch\n---\n"), []);
	// Versioning writes the new generator version into the schemas, so versioning regenerates them.
	const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	assert.equal(scripts['version-packages'], 'changeset version && npm run schema:generate');
});

test('a changeset file is tracked, never ignored', () => {
	const ignored = spawnSync('git', ['check-ignore', '--no-index', '.changeset/brave-cats-sing.md'], { cwd: ROOT });
	assert.equal(ignored.status, 1, 'git check-ignore finds no rule ignoring a changeset');
});
