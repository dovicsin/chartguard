import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { publishedPackages } from '../../tools/shared/workspace.mjs';

/**
 * CG-07-05: each published package as a user gets it. Packed, then installed by npm alone into a fresh
 * project outside this repository (its `@chartguard` dependencies from their tarballs, everything else
 * from the registry, no lifecycle scripts), and used as a consumer uses it: every entry point imported
 * and required (Node 22.12 and later load ES modules with `require`), its bin run, its declarations
 * compiled by a strict TypeScript consumer with Node16 and with bundler resolution. An adapter brings no
 * chart runtime but those it names as peers. CI runs this on Linux, Windows and macOS on the lowest Node
 * the packages support and on the newest LTS.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHELL = process.platform === 'win32';
const TSC = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
/** Chart runtimes, each a library's or a part of one. */
const RUNTIMES = ['chart.js', 'echarts', 'zrender', 'highcharts'];
/** Bounds the walk over an installed tree (E-rows: a walk is bounded in total). */
const MAX_INSTALLED = 2000;

function run(command, args, options) {
	const result = spawnSync(command, args, { encoding: 'utf8', shell: SHELL, ...options });
	const [stdout, stderr] = [result.stdout ?? '', result.stderr ?? ''];
	return { status: result.status, stdout, stderr, output: `${stdout}${stderr}` };
}

/**
 * What a load wrote to stderr besides Node's own notice that `require` of an ES module is experimental
 * (Node 22.12 writes it for every such `require` outside node_modules; 22.13 and later do not).
 */
const unexpectedStderr = (stderr) =>
	stderr
		.split('\n')
		.filter(
			(line) =>
				line.trim() !== '' &&
				!/ExperimentalWarning: CommonJS module .* is loading ES Module .* using require\(\)\.$/u.test(line) &&
				line !== 'Support for loading ES Module in require() is an experimental feature and might change at any time' &&
				!line.startsWith('(Use `node --trace-warnings')
		);

const node = (args, cwd) => run(process.execPath, args, { cwd, shell: false });

const manifests = publishedPackages(ROOT).map(({ manifest }) => manifest);
const workspace = mkdtempSync(join(tmpdir(), 'chartguard-consumers-'));
/** The tarball of each package, relative to a consumer project (`file:` specifiers, the same on every platform). */
const tarballs = new Map();

before(() => {
	mkdirSync(join(workspace, 'tarballs'));
	const packed = run(
		'npm',
		[
			'pack',
			'--json',
			'--pack-destination',
			join(workspace, 'tarballs'),
			...manifests.flatMap(({ name }) => ['-w', name])
		],
		{ cwd: ROOT }
	);
	assert.equal(packed.status, 0, packed.output);
	for (const { name, filename } of JSON.parse(packed.output.slice(packed.output.indexOf('['))))
		tarballs.set(name, `file:../tarballs/${filename}`);
});

after(() => rmSync(workspace, { recursive: true, force: true }));

/** A fresh project with `name` installed by npm, as a user installs it. */
function consumer(name) {
	const project = join(workspace, name.replace('/', '__'));
	mkdirSync(project);
	const overrides = Object.fromEntries(tarballs);
	writeFileSync(
		join(project, 'package.json'),
		JSON.stringify({
			name: 'consumer',
			private: true,
			type: 'module',
			dependencies: { [name]: tarballs.get(name) },
			overrides
		})
	);
	const installed = run(
		'npm',
		['install', '--prefer-offline', '--no-audit', '--no-fund', '--ignore-scripts', '--no-package-lock'],
		{
			cwd: project
		}
	);
	assert.equal(installed.status, 0, installed.output);
	return project;
}

/** In one `node_modules` directory: the manifests of its packages and the directories to read next. */
function readInstalled(directory) {
	const packages = [];
	const next = [];
	for (const entry of existsSync(directory) ? readdirSync(directory, { withFileTypes: true }) : []) {
		if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
		const path = join(directory, entry.name);
		// A scope holds packages; a package may hold its own node_modules.
		if (entry.name.startsWith('@')) next.push(path);
		else next.push(join(path, 'node_modules'));
		if (!entry.name.startsWith('@') && existsSync(join(path, 'package.json')))
			packages.push(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')));
	}
	return { packages, next };
}

/** The manifest of every package installed in `project`, at any depth. */
function installedPackages(project) {
	const found = [];
	const directories = [join(project, 'node_modules')];
	for (let index = 0; index < directories.length; index++) {
		assert.ok(directories.length < MAX_INSTALLED, `more than ${String(MAX_INSTALLED)} installed directories`);
		const { packages, next } = readInstalled(directories[index]);
		found.push(...packages);
		directories.push(...next);
	}
	return found;
}

/** Every entry point a package exports, as a consumer names it. */
const entryPoints = ({ name, exports }) =>
	Object.keys(typeof exports === 'object' ? exports : { '.': true })
		.filter((key) => key === '.' || key.startsWith('./'))
		.map((key) => (key === '.' ? name : `${name}${key.slice(1)}`));

/** Each entry point's export names, loaded with `import` and with `require` in `project`. */
function loaded(project, specifiers) {
	const list = JSON.stringify(specifiers);
	const imported = node(
		[
			'--input-type=module',
			'-e',
			`const out = {}; for (const s of ${list}) out[s] = Object.keys(await import(s)).sort(); console.log(JSON.stringify(out));`
		],
		project
	);
	const required = node(
		[
			'--input-type=commonjs',
			'-e',
			`const out = {}; for (const s of ${list}) out[s] = Object.keys(require(s)).filter((k) => k !== '__esModule' && k !== 'module.exports').sort(); console.log(JSON.stringify(out));`
		],
		project
	);
	return { imported, required };
}

/** TypeScript errors of a strict consumer that imports every entry point, with `resolution` options. */
function compiled(project, specifiers, resolution) {
	writeFileSync(
		join(project, 'consumer.ts'),
		`${specifiers.map((specifier, index) => `import * as entry${String(index)} from '${specifier}';`).join('\n')}\nexport const entries = [${specifiers.map((_, index) => `entry${String(index)}`).join(', ')}];\n`
	);
	const config = {
		compilerOptions: { ...resolution, target: 'es2022', strict: true, noEmit: true, skipLibCheck: false, types: [] },
		files: ['consumer.ts']
	};
	writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(config));
	return node([TSC, '-p', 'tsconfig.json'], project);
}

/** A chart runtime is installed only as a peer the package names, or as a part of one. */
function assertIsolated(manifest, installed) {
	const peers = Object.keys(manifest.peerDependencies ?? {});
	const allowed = new Set(
		peers.flatMap((peer) => [peer, ...Object.keys(installed.find((item) => item.name === peer)?.dependencies ?? {})])
	);
	assert.deepEqual(
		installed.map(({ name }) => name).filter((name) => RUNTIMES.includes(name) && !allowed.has(name)),
		[]
	);
}

/** Every entry point loads with `import` and with `require`, to the same exports, saying nothing else. */
function assertLoads(project, specifiers) {
	const { imported, required } = loaded(project, specifiers);
	assert.equal(imported.status, 0, imported.output);
	assert.equal(required.status, 0, required.output);
	assert.deepEqual([imported.stderr, unexpectedStderr(required.stderr)], ['', []]);
	assert.deepEqual(JSON.parse(required.stdout), JSON.parse(imported.stdout));
}

/** Each bin the package declares runs through npm, as a user runs it. */
function assertBins(manifest, project) {
	const bins = typeof manifest.bin === 'string' ? { [manifest.name]: manifest.bin } : (manifest.bin ?? {});
	for (const bin of Object.keys(bins)) {
		const help = run('npm', ['exec', '--offline', '--no', '--', bin, 'help'], { cwd: project });
		assert.equal(help.status, 0, help.output);
	}
}

/** A strict TypeScript consumer compiles with the package's declarations, with Node16 and with bundler resolution. */
function assertTypes(project, specifiers) {
	for (const resolution of [
		{ module: 'nodenext', moduleResolution: 'nodenext' },
		{ module: 'preserve', moduleResolution: 'bundler' }
	]) {
		const types = compiled(project, specifiers, resolution);
		assert.equal(types.status, 0, `${resolution.moduleResolution}: ${types.output}`);
	}
}

for (const manifest of manifests)
	test(`${manifest.name} installs alone in a fresh project and works as its consumers use it`, () => {
		const project = consumer(manifest.name);
		assertIsolated(manifest, installedPackages(project));
		const specifiers = entryPoints(manifest);
		assertLoads(project, specifiers);
		assertBins(manifest, project);
		assertTypes(project, specifiers);
	});
