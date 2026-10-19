import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { libraries } = JSON.parse(
	readFileSync(new URL('../../packages/schema-generator/upstream-sources.json', import.meta.url), 'utf8')
);

test('every supported library is pinned to an exact, integrity-checked version', () => {
	assert.deepEqual(
		libraries.map(({ library }) => library),
		['chartjs', 'echarts', 'highcharts']
	);
	for (const { version, integrity, primary } of libraries) {
		assert.match(version, /^\d+\.\d+\.\d+$/);
		assert.match(integrity, /^sha512-/);
		assert.equal(primary.confidence, 'authoritative');
	}
});

test('unversioned secondary sources are hashed and never authoritative', () => {
	for (const source of libraries
		.flatMap(({ secondary }) => secondary)
		.filter(({ pin }) => pin.startsWith('unversioned'))) {
		assert.match(source.sha256, /^[0-9a-f]{64}$/);
		assert.equal(source.confidence, 'derived');
	}
});

test('every library declares its redistribution status explicitly', () => {
	for (const { license } of libraries) assert.ok(license.redistribution.length > 0);
});
