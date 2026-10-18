import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact } from '@chartguard/config-core';

import { schema, validate } from '../dist/index.js';
import artifact from '../src/generated/chartjs-4.5.1.json' with { type: 'json' };
import { KNOWN_VALID } from './fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT } from './fixtures/runtime-contract.mjs';

for (const [name, config] of Object.entries(KNOWN_VALID))
	test(`known-valid: ${name}`, () => {
		const result = validate(config);
		assert.equal(result.valid, true);
		assert.deepEqual(
			result.diagnostics.filter((d) => d.severity !== 'info'),
			[]
		);
	});

const findingsOf = (config) => validate(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
const errorsOf = (config) =>
	validate(config)
		.diagnostics.filter((d) => d.severity === 'error')
		.map((d) => `${d.code} ${d.path}`);

for (const { name, config, findings } of RUNTIME_CONTRACT)
	test(`runtime contract: ${name}`, () => assert.deepEqual(findingsOf(config), findings));

test('unknown chart types and keys carry suggestions', () => {
	const suggestionOf = (config) => validate(config).diagnostics.map((d) => d.suggestion);
	assert.deepEqual(suggestionOf({ type: 'barr', data: { datasets: [] } }), ['Did you mean "bar"?']);
	assert.deepEqual(suggestionOf({ type: 'bar', data: { datasets: [] }, options: { responsiv: true } }), [
		'Did you mean "responsive"?'
	]);
});

test('the manifest is generated for the exact pinned version', () => {
	const { manifest } = schema();
	assert.equal(manifest.version, '4.5.1');
	assert.equal(manifest.coverage, 'partial');
	assert.equal(manifest.source, 'chart.js@4.5.1');
});

test('the shipped artifact is well-formed, so the adapter may skip the check at import time', () => {
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.equal(schema(), schema());
});

test('scriptable colors accept strings, arrays, host objects and callbacks alike', () => {
	const dataset = (backgroundColor) => ({ type: 'bar', data: { datasets: [{ data: [1], backgroundColor }] } });
	for (const color of ['red', ['red', 'blue'], () => 'red']) assert.deepEqual(errorsOf(dataset(color)), []);
	assert.deepEqual(errorsOf(dataset(true)), ['CFG_TYPE $.data.datasets[0].backgroundColor']);
});
