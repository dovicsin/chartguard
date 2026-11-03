import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

import { codeFromText } from '../../../scripts/tests/browser-guards.mjs';
import { buildPlayground } from '../scripts/build.mjs';

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
});

test('the bundle: no code or markup made from text in our sources, and a CSP without eval', async () => {
	const metafile = await built;
	const ours = Object.keys(metafile.inputs).filter(
		(input) => input.startsWith('apps/playground/src/') || input.includes('packages/')
	);
	// On the syntax tree (R18): the analysis names `eval` in its code and comments, and never calls it.
	assert.deepEqual(codeFromText(ours.map((path) => ({ path, text: readFileSync(path, 'utf8') }))), []);
	const html = readFileSync(join(outdir, 'index.html'), 'utf8');
	assert.match(html, /script-src 'self';/);
	assert.doesNotMatch(html, /unsafe-eval/);
});

test('the dev server listens on the loopback interface only, the address it prints (K19)', async () => {
	const { serveOptions } = await import('../scripts/serve.mjs');
	const options = serveOptions(8080);
	assert.equal(options.host, '127.0.0.1');
	assert.equal(options.port, 8080);
});
