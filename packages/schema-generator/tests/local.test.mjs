import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildLocalSchema, generateArtifact, localSchemaPath, pinOf, verifiedUpstream } from '../index.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const INSTALLED = join(ROOT, 'node_modules', 'highcharts');

/** A user's project: highcharts linked from this repository's install, or a copy to edit. */
function project(t, { copy = false, lockfile = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-project-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'node_modules'));
	const target = join(root, 'node_modules', 'highcharts');
	if (copy) cpSync(INSTALLED, target, { recursive: true });
	else symlinkSync(INSTALLED, target, 'dir');
	const { version, integrity } = pinOf('highcharts');
	if (lockfile)
		writeFileSync(
			join(root, 'package-lock.json'),
			JSON.stringify({ packages: { 'node_modules/highcharts': { version, integrity } } })
		);
	return root;
}

function setVersion(root, version) {
	const manifest = join(root, 'node_modules/highcharts/package.json');
	writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version }));
}

test("a user's build of the pinned version is byte for byte the maintainer's artifact", (t) => {
	const root = project(t);
	const built = buildLocalSchema(root, 'highcharts');
	assert.equal(built.path, localSchemaPath(root, 'highcharts', '13.1.1'));
	assert.equal(built.path, join(root, 'node_modules/.cache/chartguard/highcharts-13.1.1.json'));
	const maintainer = generateArtifact(ROOT, 'highcharts', verifiedUpstream(ROOT, 'highcharts'));
	assert.equal(readFileSync(built.path, 'utf8'), maintainer.text);
	assert.equal(built.digest, maintainer.artifact.digest);
});

test('another version of the same major builds when every fact is found, recording that version and its integrity', (t) => {
	const root = project(t, { copy: true, lockfile: false });
	setVersion(root, '13.0.9');
	const built = buildLocalSchema(root, 'highcharts');
	const artifact = JSON.parse(readFileSync(built.path, 'utf8'));
	assert.deepEqual([artifact.libraryVersion, built.version], ['13.0.9', '13.0.9']);
	assert.deepEqual(artifact.sources.highcharts, {
		kind: 'npm-package',
		locator: 'highcharts@13.0.9',
		integrity: built.integrity,
		license: 'LicenseRef-Highsoft'
	});
	assert.match(built.integrity, /^sha256-/);
});

test('an install the generator cannot read is refused, naming what is missing; nothing is written', (t) => {
	const root = project(t, { copy: true, lockfile: false });
	setVersion(root, '13.2.0');
	const runtime = join(root, 'node_modules/highcharts/highcharts.src.js');
	writeFileSync(
		runtime,
		readFileSync(runtime, 'utf8').replace(
			'error(17, true, chart, { missingModuleFor: type });',
			'error(17, true, chart);'
		)
	);
	assert.throws(() => buildLocalSchema(root, 'highcharts'), {
		name: 'UpstreamError',
		message:
			/^highcharts 13\.2\.0 could not be read by this generator \(it was verified against 13\.1\.1\): .*error\(17, true, chart, \{ missingModuleFor: type \}\)/
	});
	assert.throws(() => readFileSync(localSchemaPath(root, 'highcharts', '13.2.0')), { code: 'ENOENT' });
});

test('another major, a missing install and a library whose schema ships are refused with the reason', (t) => {
	const copied = project(t, { copy: true, lockfile: false });
	setVersion(copied, '12.4.0');
	assert.throws(() => buildLocalSchema(copied, 'highcharts'), {
		name: 'UpstreamError',
		message: /highcharts 12\.4\.0 is not supported: this generator reads 13\.x/
	});
	assert.throws(() => buildLocalSchema(mkdtempSync(join(tmpdir(), 'empty-')), 'highcharts'), {
		name: 'UpstreamError',
		message: /highcharts is not installed/
	});
	assert.throws(() => buildLocalSchema(project(t), 'chartjs'), {
		name: 'UpstreamError',
		message: 'chartjs ships its schema with its adapter; there is nothing to build.'
	});
});
