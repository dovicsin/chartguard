import assert from 'node:assert/strict';
import test from 'node:test';

import { compatibility, parseVersion, s, validateConfig } from '../dist/index.js';

test('exact versions parse; ranges, tags and partial versions do not', () => {
	assert.deepEqual(parseVersion('4.5.1'), { major: 4, minor: 5, patch: 1, prerelease: undefined });
	assert.deepEqual(parseVersion(' 6.0.0-rc.1 '), { major: 6, minor: 0, patch: 0, prerelease: 'rc.1' });
	for (const text of ['latest', '4.x', '^4.5.1', '4.5', 'v4.5.1', '4.5.1+build', ''])
		assert.equal(parseVersion(text), undefined, text);
});

test('compatibility of a requested version with the schema version', () => {
	const cases = [
		['4.5.1', '4.5.1', 'exact'],
		['4.5.1', '4.5.2', 'same-major'],
		['4.5.1', '4.4.0', 'same-major'],
		['4.5.1', '4.5.1-beta.1', 'same-major'],
		['4.5.1', '3.9.1', 'other-major'],
		['4.5.1', '5.0.0', 'other-major'],
		['4.5.1', '4.x', 'malformed'],
		['13.x (starter subset)', '13.1.1', 'same-major'],
		['13.x (starter subset)', '12.4.0', 'other-major']
	];
	for (const [schema, requested, expected] of cases)
		assert.equal(compatibility(schema, requested), expected, `${schema} ${requested}`);
});

const manifest = {
	library: 'demo',
	version: '2.3.4',
	coverage: 'full',
	source: 'test',
	root: s.object({ width: s.number(), mode: s.string(['a', 'b']) }, { additional: 'deny' })
};
const report = (config, libraryVersion) => {
	const result = validateConfig(config, manifest, libraryVersion === undefined ? {} : { libraryVersion });
	return [result.status, result.coverage, result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`)];
};
const wrong = { width: 'wide', mode: 'c' };

test('without a version or with the exact one, confirmed errors stay confirmed', () => {
	const expected = ['invalid', 'full', ['error CFG_TYPE $.width', 'error CFG_ENUM $.mode']];
	assert.deepEqual(report(wrong), expected);
	assert.deepEqual(report(wrong, '2.3.4'), expected);
	assert.deepEqual(report({ width: 1 }, '2.3.4'), ['valid', 'full', []]);
});

test('another minor or patch: the same findings, as warnings, with an explanation and partial coverage', () => {
	assert.deepEqual(report(wrong, '2.1.0'), [
		'partial',
		'partial',
		['warning CFG_VERSION_MISMATCH $', 'warning CFG_TYPE $.width', 'warning CFG_ENUM $.mode']
	]);
	assert.deepEqual(report({ width: 1 }, '2.3.5')[0], 'partial');
});

test('another major or a malformed version: not validated, explained, partial', () => {
	assert.deepEqual(report(wrong, '1.0.0'), ['partial', 'partial', ['warning CFG_UNSUPPORTED_VERSION $']]);
	const malformed = validateConfig(wrong, manifest, { libraryVersion: 'latest' });
	assert.equal(malformed.valid, true);
	assert.match(malformed.diagnostics[0].message, /"latest" is not an exact version/);
});
