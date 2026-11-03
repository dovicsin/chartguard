import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import test, { after } from 'node:test';

import { codeFromText } from '../../../scripts/tests/browser-guards.mjs';
import { byCodeUnit } from '../../../tools/shared/notices.mjs';
import { APP, buildPlayground, NOTICES, ROOT } from '../scripts/build.mjs';

/** One build for the bundle tests, removed when they are done. */
const outdir = mkdtempSync(join(tmpdir(), 'playground-'));
after(() => rmSync(outdir, { recursive: true, force: true }));
const built = buildPlayground(outdir);

test('the bundle: a small entry without schemas or TypeScript, one lazy chunk per library', async () => {
	await built;
	const entry = readFileSync(join(outdir, 'main.js'), 'utf8');
	assert.ok(entry.length < 50_000, `entry is ${String(entry.length)} bytes`);
	assert.equal(entry.includes('irVersion'), false);
	// TypeScript and the analysis load only in source mode (CG-06-06 part 3).
	assert.equal(entry.includes('createSourceFile'), false);
	const chunks = readdirSync(join(outdir, 'chunks'))
		.filter((file) => file.endsWith('.js'))
		.map((file) => readFileSync(join(outdir, 'chunks', file), 'utf8'));
	// The committed schemas ship; a Highcharts-derived one may not be redistributed (CG-01-05).
	const bundled = ['"chart.js@4.5.1"', '"echarts@6.1.0"', '"highcharts@13.1.1"'].map((locator) =>
		chunks.some((text) => text.includes(locator))
	);
	assert.deepEqual(bundled, [true, true, false]);
	assert.ok(chunks.some((text) => text.includes('createSourceFile')));
	assert.ok(JSON.parse(readFileSync(join(outdir, 'examples.json'), 'utf8')).length > 0);
	assert.ok(readFileSync(join(outdir, 'frame.js'), 'utf8').length > 0);
});

test('the site carries the licences and notices of every package its bundles hold, in code-unit order', async () => {
	await built;
	const notices = readFileSync(join(outdir, NOTICES), 'utf8');
	const names = [...notices.matchAll(/^(@?[\w./-]+) \d+\.\d+\.\d+\S* \(/gmu)].map(([, name]) => name);
	for (const name of [
		'chart.js',
		'echarts',
		'zrender',
		'typescript',
		'fflate',
		'@chartguard/core',
		'@chartguard/config-echarts'
	])
		assert.ok(names.includes(name), name);
	assert.equal(names.includes('@chartguard/playground'), false);
	assert.deepEqual(names, [...names].sort(byCodeUnit));
	assert.match(notices, /Apache License/u);
	assert.equal(
		names.some((name) => name.startsWith('highcharts')),
		false
	);
});

test('the bundle: code from text only in the sandboxed frame, a page CSP without eval, a frame CSP without network', async () => {
	const metafile = await built;
	// The bundler names inputs relative to the working directory: resolved, the gate reads the same
	// sources from any directory it runs in (E39).
	const inside = (path, directory) => !relative(directory, path).startsWith('..');
	const ours = Object.keys(metafile.inputs)
		.map((input) => resolve(input))
		.filter((path) => inside(path, join(APP, 'src')) || inside(path, join(ROOT, 'packages')));
	assert.ok(ours.some((path) => inside(path, join(ROOT, 'packages', 'core'))));
	// On the syntax tree (R18): the analysis names `eval` in its code and comments, and never calls it.
	// One place runs code from text, on the user's request: the sandboxed frame (CG-06-06 part 4).
	const found = codeFromText(ours.map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') })));
	assert.equal(found.length, 1, found.join(', '));
	assert.match(found[0].split(sep).join('/'), /^apps\/playground\/src\/frame\.ts:\d+$/u);
	const html = readFileSync(join(outdir, 'index.html'), 'utf8');
	assert.match(html, /script-src 'self';/);
	assert.doesNotMatch(html, /unsafe-eval/);
	// The frame's own CSP: no network, and eval only there, in an opaque origin.
	const frame = readFileSync(join(outdir, 'frame.html'), 'utf8');
	assert.match(frame, /connect-src 'none'/u);
	assert.match(frame, /default-src 'none'/u);
});

test('the dev server listens on the loopback interface only, the address it prints (K19)', async () => {
	const { serveOptions } = await import('../scripts/serve.mjs');
	const options = serveOptions(8080);
	assert.equal(options.host, '127.0.0.1');
	assert.equal(options.port, 8080);
	assert.deepEqual(options.cors, { origin: 'null' });
});
