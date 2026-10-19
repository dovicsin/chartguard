import assert from 'node:assert/strict';
import test from 'node:test';

import { formatJson, isJsonSafe } from '../dist/examples.js';
import { compare } from '../dist/selftest.js';
import { collectExamples } from '../scripts/build.mjs';

test('only plain JSON values are shown as editable examples', () => {
	for (const value of [null, 'a', 1, true, [], {}, { a: [1, { b: null }] }, Object.create(null)]) assert.equal(isJsonSafe(value), true);
	const cyclic = {};
	cyclic.self = cyclic;
	const sparse = [1, 2];
	delete sparse[0];
	for (const value of [undefined, () => 1, new Date(), new Float32Array(1), Number.NaN, Infinity, new (class X {})(), cyclic, sparse, [undefined]])
		assert.equal(isJsonSafe(value), false, String(value));
	assert.equal(formatJson({ a: 1 }), '{\n  "a": 1\n}');
});

test('examples come from the runtime-verified fixtures of every library, with unique ids', async () => {
	const examples = await collectExamples();
	const ids = examples.map(({ id }) => id);
	assert.equal(new Set(ids).size, ids.length);
	for (const library of ['chartjs', 'echarts', 'highcharts']) assert.ok(examples.some((example) => example.library === library), library);
	// The Highcharts contract pins the locally generated schema; the playground validates with the curated subset.
	assert.deepEqual(
		examples.filter((example) => example.library === 'highcharts' && example.group === 'contract'),
		[]
	);
	for (const example of examples) {
		assert.ok(isJsonSafe(example.config), example.id);
		assert.equal(example.group === 'contract', example.expected !== undefined, example.id);
	}
});

test('self-test comparison: valid examples must be quiet, contract examples must match exactly', () => {
	const valid = { id: 'v', library: 'chartjs', title: 'v', group: 'valid', config: {} };
	assert.deepEqual(compare(valid, { findings: ['info CFG_AMBIGUOUS $'], runtime: 'accepted' }), []);
	assert.deepEqual(compare(valid, { findings: ['warning CFG_UNKNOWN_KEY $.a'], runtime: 'accepted' }), [
		'findings ["warning CFG_UNKNOWN_KEY $.a"] != "no warning or error"'
	]);
	assert.deepEqual(compare(valid, { findings: [], runtime: 'complained' }), ['runtime complained != accepted']);
	assert.deepEqual(compare(valid, { findings: [], runtime: undefined }), []);
	const contract = { ...valid, group: 'contract', expected: { findings: ['error CFG_TYPE $.a'], runtime: 'accepted' } };
	assert.deepEqual(compare(contract, { findings: ['error CFG_TYPE $.a'], runtime: 'accepted' }), []);
	assert.equal(compare(contract, { findings: [], runtime: 'rejected' }).length, 2);
});
