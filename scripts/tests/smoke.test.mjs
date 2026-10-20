import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { publishedPackages } from '../../tools/shared/workspace.mjs';

/**
 * The M0 gate: every published package installs from its own tarball and works there. Each gets
 * only the external and peer dependencies it declares, in its own node_modules, so an undeclared
 * dependency or a file missing from `files` fails here rather than for a user.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SHELL = process.platform === 'win32';

function run(command, args, options) {
	const result = spawnSync(command, args, { encoding: 'utf8', shell: SHELL, ...options });
	return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Every package packed with npm, as a consumer would download it: the tarball file per package name. */
function packAll(directory, manifests) {
	const workspaces = manifests.flatMap(({ name }) => ['-w', name]);
	const packed = run('npm', ['pack', '--json', '--pack-destination', directory, ...workspaces], { cwd: ROOT });
	assert.equal(packed.status, 0, packed.output);
	return JSON.parse(packed.output.slice(packed.output.indexOf('[')));
}

/** One package from its tarball, with only what it declares beside it: dependencies and peers outside the scope. */
function installOne(project, tarball, manifest) {
	const target = join(project, 'node_modules', ...manifest.name.split('/'));
	mkdirSync(target, { recursive: true });
	const extracted = run('tar', ['-xzf', tarball, '--strip-components=1', '-C', target]);
	assert.equal(extracted.status, 0, extracted.output);
	const declared = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
	for (const dependency of declared.filter((name) => !name.startsWith('@chartguard/'))) {
		const link = join(target, 'node_modules', ...dependency.split('/'));
		mkdirSync(join(link, '..'), { recursive: true });
		symlinkSync(join(ROOT, 'node_modules', ...dependency.split('/')), link, 'junction');
	}
}

/** Every entry a package exports, as a consumer imports it. */
const entryPoints = (manifests) =>
	manifests.flatMap(({ name, exports }) =>
		Object.keys(typeof exports === 'object' ? exports : { '.': true })
			.filter((key) => key === '.' || key.startsWith('./'))
			.map((key) => (key === '.' ? name : `${name}${key.slice(1)}`))
	);

/** The specifiers that fail to load in `project`, with why. */
function failingImports(project, specifiers) {
	const script = `const failed = []; for (const specifier of ${JSON.stringify(specifiers)}) { try { await import(specifier); } catch (error) { failed.push(specifier + ': ' + error.message); } } console.log(JSON.stringify(failed));`;
	const loaded = run(process.execPath, ['--input-type=module', '-e', script], { cwd: project, shell: false });
	assert.equal(loaded.status, 0, loaded.output);
	return JSON.parse(loaded.output.trim().split('\n').at(-1));
}

test('every published package installs from its tarball and every entry point it exports loads', (t) => {
	const project = mkdtempSync(join(tmpdir(), 'chartguard-smoke-'));
	t.after(() => rmSync(project, { recursive: true, force: true }));
	const manifests = publishedPackages(ROOT).map(({ manifest }) => manifest);
	assert.ok(manifests.length >= 10, `found ${String(manifests.length)} packages`);
	mkdirSync(join(project, 'tarballs'));
	for (const { name, filename } of packAll(join(project, 'tarballs'), manifests))
		installOne(
			project,
			join(project, 'tarballs', filename),
			manifests.find((manifest) => manifest.name === name)
		);
	assert.deepEqual(failingImports(project, entryPoints(manifests)), []);
});

test('the installed CLI works from its own files: help, a validation, a project analysis', (t) => {
	const project = mkdtempSync(join(tmpdir(), 'chartguard-smoke-cli-'));
	t.after(() => rmSync(project, { recursive: true, force: true }));
	const manifests = publishedPackages(ROOT).map(({ manifest }) => manifest);
	mkdirSync(join(project, 'tarballs'));
	for (const { name, filename } of packAll(join(project, 'tarballs'), manifests))
		installOne(
			project,
			join(project, 'tarballs', filename),
			manifests.find((manifest) => manifest.name === name)
		);
	const cli = join(project, 'node_modules', '@chartguard', 'cli', 'bin', 'chartguard.mjs');
	const node = (args) => run(process.execPath, [cli, ...args], { cwd: project, shell: false });
	assert.equal(node(['help']).status, 0);
	assert.equal(
		node(['validate', '--library', 'chartjs', '--file', join(ROOT, 'examples', 'chartjs-invalid.json')]).status,
		1
	);
	const analyzed = node([
		'analyze',
		'--library',
		'echarts',
		'--project',
		join(ROOT, 'examples', 'sample-app', 'tsconfig.json')
	]);
	assert.equal(analyzed.status, 1, analyzed.output);
	assert.match(analyzed.output, /traffic\.js:4:\d+ \$\.xAxis\.boundaryGap/);
});
