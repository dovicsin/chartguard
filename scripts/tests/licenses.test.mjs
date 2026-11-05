import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { NOTICES, outputs } from '../../tools/schema-generator/generate.mjs';
import { noticesText, packageNotices } from '../../tools/shared/notices.mjs';
import { manifestsUnder, publishedPackages } from '../../tools/shared/workspace.mjs';

/**
 * CG-07-06: what each package publishes carries the licences it owes. Every package ships the
 * project's licence; a package shipping a schema derived from an upstream package ships a notice
 * of how it is derived and the licence and notices of every package the schema names as a source;
 * what a package brings at run time is under a licence of the reviewed allowlist.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LICENSE = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
/**
 * Licences reviewed for what the packages bring at run time (docs/reviews/CG-07-06-license-review.md):
 * permissive, asking at most for their licence and notices to be kept.
 */
const ALLOWED = new Set(['0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT']);

const workspace = manifestsUnder(join(ROOT, 'packages'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')).packages;
const directoryOf = (path) => relative(ROOT, path).split(sep).join('/');

/** The files of each published package's tarball, as `npm pack` writes it. */
function packed() {
	const result = spawnSync(
		'npm',
		['pack', '--dry-run', '--json', ...publishedPackages(ROOT).flatMap(({ manifest }) => ['-w', manifest.name])],
		{ cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
	);
	assert.equal(result.status, 0, result.stderr);
	return new Map(
		JSON.parse(result.stdout.slice(result.stdout.indexOf('['))).map(({ name, files }) => [
			name,
			new Set(files.map(({ path }) => path))
		])
	);
}

/** The lockfile key a `name` required from the lockfile location `from` resolves to, as Node resolves it. */
function locate(from, name) {
	for (let at = from; ;) {
		const key = at === '' ? `node_modules/${name}` : `${at}/node_modules/${name}`;
		if (lock[key] !== undefined) return lock[key].link === true ? lock[key].resolved : key;
		if (at === '') return undefined;
		const nested = at.lastIndexOf('/node_modules/');
		at = nested === -1 ? '' : at.slice(0, nested);
	}
}

/** Every package `directory` brings at run time (dependencies and optional ones, transitively), with its licence. */
function runtimeClosure(directory) {
	const found = new Map();
	const queue = [directory];
	for (let index = 0; index < queue.length; index++) {
		const entry = lock[queue[index]];
		for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
			const key = locate(queue[index], name);
			assert.ok(key !== undefined, `${queue[index]}: ${name} is not in the lockfile`);
			if (found.has(key) || key === directory) continue;
			found.set(key, lock[key].license);
			queue.push(key);
		}
	}
	return [...found].filter(([key]) => !key.startsWith('packages/'));
}

test('every package ships the project licence, in its directory and in its tarball', () => {
	for (const { path } of workspace)
		assert.equal(readFileSync(join(path, 'LICENSE'), 'utf8'), LICENSE, directoryOf(path));
	for (const [name, files] of packed()) assert.ok(files.has('LICENSE'), `${name} packs LICENSE`);
});

test('a package shipping a derived schema ships how it is derived and every source licence and notice, current', () => {
	const tarballs = packed();
	for (const library of ['chartjs', 'echarts']) {
		const [artifact, notices] = outputs(ROOT, library);
		const directory = join(ROOT, 'packages', 'config', library);
		const { name } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
		assert.equal(notices.path, join(directory, NOTICES));
		assert.equal(readFileSync(notices.path, 'utf8'), notices.text, `${NOTICES} of ${name} is current`);
		for (const file of [
			'NOTICE',
			NOTICES,
			`dist/generated/${relative(join(directory, 'src', 'generated'), artifact.path)}`
		])
			assert.ok(tarballs.get(name).has(file), `${name} packs ${file}`);
		const notice = readFileSync(join(directory, 'NOTICE'), 'utf8');
		for (const { locator, license } of Object.values(JSON.parse(artifact.text).sources)) {
			const [source, version] = [
				locator.slice(0, locator.lastIndexOf('@')),
				locator.slice(locator.lastIndexOf('@') + 1)
			];
			assert.ok(notice.includes(locator), `NOTICE of ${name} names ${locator}`);
			assert.ok(notices.text.includes(`${source} ${version} (${license})`), `${NOTICES} of ${name} carries ${locator}`);
		}
	}
});

test('what each package brings at run time is under a reviewed licence', () => {
	for (const { path } of workspace) {
		const directory = directoryOf(path);
		if (lock[directory] === undefined) continue;
		for (const [key, license] of runtimeClosure(directory))
			assert.ok(ALLOWED.has(license), `${directory} brings ${key} under ${String(license)}`);
	}
});

const scratch = mkdtempSync(join(tmpdir(), 'chartguard-licenses-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('a package installed twice at one version is one notice; two versions are two', () => {
	const fake = (path, version, license) => {
		mkdirSync(join(scratch, path), { recursive: true });
		writeFileSync(join(scratch, path, 'package.json'), JSON.stringify({ name: 'tslib', version, license }));
		writeFileSync(join(scratch, path, 'LICENSE'), 'Copyright (c) Microsoft Corporation.\r\n\r\nPermission to use…\r\n');
	};
	fake('a/tslib', '2.3.0', '0BSD');
	fake('b/tslib', '2.3.0', '0BSD');
	fake('c/tslib', '2.8.1', '0BSD');
	const entries = packageNotices(['a/tslib', 'b/tslib', 'c/tslib'].map((path) => join(scratch, path)));
	assert.deepEqual(
		entries.map(({ text }) => text.split('\n')[0]),
		['tslib 2.3.0 (0BSD)', 'tslib 2.8.1 (0BSD)']
	);
	// A licence written with CRLF is carried with LF, as a tracked copy is checked out (.gitattributes).
	assert.ok(!noticesText(entries).includes('\r'));
});

test('a licence outside the reviewed allowlist is reported', () => {
	const saved = lock['packages/core'];
	lock['packages/core'] = { dependencies: { 'left-pad': '1.0.0' } };
	lock['node_modules/left-pad'] = { version: '1.0.0', license: 'WTFPL' };
	try {
		assert.deepEqual(runtimeClosure('packages/core'), [['node_modules/left-pad', 'WTFPL']]);
		assert.equal(ALLOWED.has('WTFPL'), false);
	} finally {
		lock['packages/core'] = saved;
		delete lock['node_modules/left-pad'];
	}
});
