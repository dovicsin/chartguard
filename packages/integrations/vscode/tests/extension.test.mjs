import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { KEYS, settingsOf } from '../dist/settings.js';
import { built, bundle, byCodeUnit, NOTICES } from '../scripts/bundle.mjs';
import { QUIET_FLAGS, SETTINGS, VSCODE_VERSION } from '../scripts/run-vscode-tests.mjs';

/** The VS Code extension (CG-06-05) outside VS Code: its settings, its bundles and what its VSIX holds. */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
const vsce = createRequire(import.meta.url).resolve('@vscode/vsce/vsce');

test('settings: only what is set, as plain JSON; every key the server reads is a contributed, restricted setting', () => {
	const values = { libraryVersion: { chartjs: 'auto' }, registries: null, project: false, quality: undefined };
	const section = { get: (key) => values[key], has: () => true };
	assert.deepEqual(settingsOf(section), { libraryVersion: { chartjs: 'auto' }, project: false });
	const contributed = Object.keys(manifest.contributes.configuration.properties).map((key) =>
		key.replace('chartguard.', '')
	);
	assert.deepEqual(contributed, [...KEYS]);
	assert.deepEqual(
		manifest.capabilities.untrustedWorkspaces.restrictedConfigurations,
		KEYS.map((key) => `chartguard.${key}`)
	);
});

test('the bundles hold their packages with their licences and notices, VS Code left to VS Code, no Highcharts-derived schema', async () => {
	const { inputs, packages } = await bundle();
	const notices = readFileSync(NOTICES, 'utf8');
	for (const name of ['typescript', 'vscode-languageclient', '@chartguard/source-checks', '@chartguard/config-echarts'])
		assert.ok(packages.includes(name), name);
	assert.deepEqual(packages, [...packages].sort(byCodeUnit));
	// The extension's own code is ChartGuard's, under its own licence: not a third party.
	assert.equal(packages.includes(manifest.name), false);
	assert.match(notices, /^typescript \d+\.\d+\.\d+ \(Apache-2\.0\)\n\nApache License/mu);
	assert.match(notices, /Apache ECharts/u);
	// A schema built from the user's Highcharts install is read at run time, never shipped (CG-01-05).
	assert.deepEqual(
		inputs.filter((input) => /\.cache[\\/]chartguard|highcharts-\d/u.test(input)),
		[]
	);
	const extension = readFileSync(join(PACKAGE, 'dist', 'extension.cjs'), 'utf8');
	assert.match(extension, /require\("vscode"\)/u);
	assert.doesNotMatch(readFileSync(join(PACKAGE, 'dist', 'server.cjs'), 'utf8'), /require\("vscode"\)/u);
});

test('the VSIX holds the manifest, the README, the licence, the two bundles and their notices: nothing else', (t) => {
	const listed = spawnSync(process.execPath, [vsce, 'ls', '--no-dependencies'], { cwd: PACKAGE, encoding: 'utf8' });
	assert.equal(listed.status, 0, listed.stderr);
	assert.deepEqual(listed.stdout.trim().split('\n').sort(), [
		'LICENSE',
		'README.md',
		'dist/THIRD-PARTY-NOTICES.txt',
		'dist/extension.cjs',
		'dist/server.cjs',
		'package.json'
	]);
	const out = mkdtempSync(join(tmpdir(), 'chartguard-vsix-'));
	t.after(() => rmSync(out, { recursive: true, force: true }));
	const packed = spawnSync(
		process.execPath,
		[vsce, 'package', '--no-dependencies', '--out', join(out, 'chartguard.vsix')],
		{
			cwd: PACKAGE,
			encoding: 'utf8'
		}
	);
	assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
});

test('the editor tests run in an exact VS Code with a quiet profile (E75)', () => {
	// The latest stable changed under the tests: 1.144 opened the chat view at startup, and a view taking
	// focus cancels `showTextDocument` ("Canceled" in one run of four).
	assert.match(VSCODE_VERSION, /^\d+\.\d+\.\d+$/u);
	assert.equal(SETTINGS['workbench.startupEditor'], 'none');
	assert.equal(SETTINGS['chat.disableAIFeatures'], true);
	assert.deepEqual(QUIET_FLAGS, ['--skip-welcome', '--skip-release-notes']);
});

test('a bundle build that warns is refused, naming the warning (a module that reads beside itself breaks in CommonJS)', async (t) => {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-bundle-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const entry = join(directory, 'entry.mjs');
	writeFileSync(entry, "export const manifest = new URL('../package.json', import.meta.url).href;\n");
	const options = { bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', entryPoints: [entry] };
	await assert.rejects(
		built({ ...options, outfile: join(directory, 'out.cjs') }),
		/esbuild warned:\n.*entry\.mjs:1 .*import\.meta/su
	);
	writeFileSync(entry, 'export const answer = 42;\n');
	assert.equal((await built({ ...options, outfile: join(directory, 'ok.cjs') })).warnings.length, 0);
});
