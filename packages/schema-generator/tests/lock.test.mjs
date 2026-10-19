import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { contentIntegrity, installedUpstream, pinOf, UpstreamError, verifiedUpstream } from '../index.mjs';

/** A project with `chart.js` at `installed`, and a lockfile entry unless `locked` is false. */
function project(t, { installed = '4.5.1', integrity, locked = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'schema-lock-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'node_modules/chart.js/dist'), { recursive: true });
	writeFileSync(join(root, 'node_modules/chart.js/package.json'), JSON.stringify({ version: installed }));
	writeFileSync(join(root, 'node_modules/chart.js/dist/chart.js'), 'export {};\n');
	const lock = {
		packages: { 'node_modules/chart.js': { version: installed, integrity: integrity ?? pinOf('chartjs').integrity } }
	};
	if (locked) writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
	return root;
}

test('the maintainer pin refuses an install that differs from it', (t) => {
	assert.throws(
		() => verifiedUpstream(project(t, { installed: '4.5.0' }), 'chartjs'),
		/installed 4\.5\.0, pinned 4\.5\.1/
	);
	assert.throws(() => verifiedUpstream(project(t, { integrity: 'sha512-other' }), 'chartjs'), /integrity differs/);
	assert.throws(() => verifiedUpstream(project(t), 'd3'), { name: 'UpstreamError', message: 'No upstream pin for d3' });
	assert.deepEqual(verifiedUpstream(project(t), 'chartjs'), pinOf('chartjs'));
});

test('an installed pin is the same major as the generator pin, with the integrity of that install', (t) => {
	const locked = installedUpstream(project(t, { installed: '4.4.9', integrity: 'sha512-theirs' }), 'chartjs');
	assert.deepEqual([locked.version, locked.integrity, locked.package], ['4.4.9', 'sha512-theirs', 'chart.js']);
	const root = project(t, { installed: '4.4.9', locked: false });
	const hashed = installedUpstream(root, 'chartjs');
	assert.equal(hashed.integrity, contentIntegrity(join(root, 'node_modules/chart.js')));
	assert.throws(() => installedUpstream(project(t, { installed: '3.9.1' }), 'chartjs'), {
		name: 'UpstreamError',
		message: 'chart.js 3.9.1 is not supported: this generator reads 4.x (pinned 4.5.1).'
	});
	assert.throws(() => installedUpstream(mkdtempSync(join(tmpdir(), 'empty-')), 'chartjs'), UpstreamError);
});

test('a lockfile entry for another version is not the integrity of this install', (t) => {
	const root = project(t, { installed: '4.4.9', locked: false });
	writeFileSync(
		join(root, 'package-lock.json'),
		JSON.stringify({ packages: { 'node_modules/chart.js': { version: '4.5.1', integrity: 'sha512-stale' } } })
	);
	assert.match(installedUpstream(root, 'chartjs').integrity, /^sha256-/);
});

test('content integrity covers every file path and byte, and nothing under a nested node_modules', (t) => {
	const root = project(t, { locked: false });
	const directory = join(root, 'node_modules/chart.js');
	const before = contentIntegrity(directory);
	assert.equal(contentIntegrity(directory), before);
	mkdirSync(join(directory, 'node_modules/dep'), { recursive: true });
	writeFileSync(join(directory, 'node_modules/dep/index.js'), 'x');
	assert.equal(contentIntegrity(directory), before);
	writeFileSync(join(directory, 'dist/chart.js'), 'export {}; \n');
	assert.notEqual(contentIntegrity(directory), before);
});
