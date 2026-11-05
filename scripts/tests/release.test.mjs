import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { manifestsUnder, publishedPackages } from '../../tools/shared/workspace.mjs';

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

/**
 * What every published README says of its state (E90): a tarball's README is the package's page on
 * npm (the extension's on the Marketplace) from the moment it is published, so it says what stays
 * true then, never that the package is not published.
 */
const STATUS =
	'**Status:** pre-release (0.x). Coverage is partial, and the API and settings may still change between minor versions.';
const UNPUBLISHED = /\bnot (?:yet )?published\b|\bnothing is published\b|\bnot yet: publishing\b/iu;

/** The problems of a published README's text: no status line, or a claim that turns false on publishing. */
function statusProblems(text) {
	const problems = [];
	if (text.split(STATUS).length !== 2) problems.push('states its status once, as STATUS');
	if (UNPUBLISHED.test(text)) problems.push('says it is not published');
	return problems;
}

test('every published README says it is a pre-release and never that it is unpublished', () => {
	const extension = manifestsUnder(join(ROOT, 'packages')).filter(({ manifest }) => manifest.publisher !== undefined);
	assert.ok(extension.length === 1, 'the VS Code extension is found by its publisher');
	const found = [...publishedPackages(ROOT), ...extension].flatMap(({ path }) =>
		statusProblems(readFileSync(join(path, 'README.md'), 'utf8')).map(
			(problem) => `${relative(ROOT, path).split(sep).join('/')}: ${problem}`
		)
	);
	// The guides are deployed before every release (the release workflow runs Pages first).
	const guides = join(ROOT, 'apps', 'reference', 'guides');
	for (const name of readdirSync(guides).filter((file) => file.endsWith('.md')))
		if (UNPUBLISHED.test(readFileSync(join(guides, name), 'utf8')))
			found.push(`guides/${name}: says it is not published`);
	assert.deepEqual(found, []);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n`), []);
	assert.deepEqual(statusProblems('# a\n\nPartial.\n'), ['states its status once, as STATUS']);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n\n${STATUS}\n`), ['states its status once, as STATUS']);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n\nNot published yet (CG-06-05).\n`), ['says it is not published']);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n\n- Not yet: publishing.\n`), ['says it is not published']);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n\nNothing is published yet.\n`), ['says it is not published']);
	assert.deepEqual(statusProblems(`# a\n\n${STATUS}\n\nPublished from CI.\n`), []);
});

/** The `meta` a package's source declares (`export const meta = { name: '…', version: '…' }`), each with its version. */
const META = /export const meta = \{ name: '(?<name>[^']+)', version: '(?<version>[^']+)' \}/gu;

/** The source files of a package, below `src` (generated JSON and build output aside; none for a JavaScript package). */
function sourcesOf(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourcesOf(join(directory, entry.name));
		return entry.name.endsWith('.ts') ? [join(directory, entry.name)] : [];
	});
}

/** The version a package tells its host (ESLint's `meta`, the language server's `serverInfo`) differing from its own. */
const staleMeta = (text, version) =>
	[...text.matchAll(META)].filter((match) => match.groups?.version !== version).map((match) => match.groups?.name);

test('a version a package tells its host is its own: Changesets bumps the manifest, this fails until the source follows (E90)', () => {
	let found = 0;
	const stale = publishedPackages(ROOT).flatMap(({ path, manifest }) =>
		sourcesOf(join(path, 'src')).flatMap((file) => {
			const text = readFileSync(file, 'utf8');
			found += [...text.matchAll(META)].length;
			return staleMeta(text, manifest.version).map((name) => `${relative(ROOT, file)}: ${String(name)}`);
		})
	);
	assert.deepEqual(stale, []);
	assert.ok(found >= 2, 'the ESLint plugin and the language server declare their meta');
	assert.deepEqual(staleMeta("export const meta = { name: 'x', version: '0.1.0' };", '0.2.0'), ['x']);
	assert.deepEqual(staleMeta("export const meta = { name: 'x', version: '0.2.0' };", '0.2.0'), []);
});
