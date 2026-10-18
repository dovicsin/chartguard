import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildPlayground } from '../scripts/build.mjs';

test('the bundle: a small entry without schemas, one lazy chunk per library, no eval, a strict CSP', async (t) => {
	const outdir = mkdtempSync(join(tmpdir(), 'playground-'));
	t.after(() => rmSync(outdir, { recursive: true, force: true }));
	const metafile = await buildPlayground(outdir);
	const entry = readFileSync(join(outdir, 'main.js'), 'utf8');
	assert.ok(entry.length < 50_000, `entry is ${String(entry.length)} bytes`);
	assert.equal(entry.includes('irVersion'), false);
	const chunks = readdirSync(join(outdir, 'chunks')).filter((file) => file.endsWith('.js'));
	assert.ok(chunks.some((file) => readFileSync(join(outdir, 'chunks', file), 'utf8').includes('"chart.js@4.5.1"')));
	assert.ok(chunks.some((file) => readFileSync(join(outdir, 'chunks', file), 'utf8').includes('"echarts@6.1.0"')));
	const ours = Object.keys(metafile.inputs).filter((input) => input.startsWith('apps/playground/src/') || input.includes('packages/'));
	for (const input of ours) assert.doesNotMatch(readFileSync(input, 'utf8'), /\beval\(|new Function\(|innerHTML|insertAdjacentHTML|document\.write/, input);
	const html = readFileSync(join(outdir, 'index.html'), 'utf8');
	assert.match(html, /script-src 'self';/);
	assert.doesNotMatch(html, /unsafe-eval/);
	assert.ok(JSON.parse(readFileSync(join(outdir, 'examples.json'), 'utf8')).length > 0);
});
