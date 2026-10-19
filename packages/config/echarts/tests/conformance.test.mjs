import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact } from '@chartguard/config-core';

import { schema, validate } from '../dist/index.js';
import artifact from '../src/generated/echarts-6.1.0.json' with { type: 'json' };
import { KNOWN_VALID } from './fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT } from './fixtures/runtime-contract.mjs';

for (const [name, option] of Object.entries(KNOWN_VALID))
	test(`known-valid: ${name}`, () => {
		const result = validate(option);
		assert.equal(result.valid, true);
		assert.deepEqual(
			result.diagnostics.filter((d) => d.severity !== 'info'),
			[]
		);
	});

const findingsOf = (option) => validate(option).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

for (const { name, config, findings } of RUNTIME_CONTRACT)
	test(`runtime contract: ${name}`, () => assert.deepEqual(findingsOf(config), findings));

test('known-invalid: wrong types inside nested and list-valued components are confirmed errors', () => {
	const report = (option) =>
		validate(option).diagnostics.map((d) => `${d.severity}/${d.confidence} ${d.code} ${d.path}`);
	assert.deepEqual(report({ title: [{ text: 'a' }, { text: 1 }] }), ['error/certain CFG_TYPE $.title[1].text']);
	assert.deepEqual(report({ series: [{ type: 'pie', radius: false }] }), ['error/certain CFG_TYPE $.series[0].radius']);
	assert.deepEqual(report({ grid: { left: {} } }), ['error/certain CFG_TYPE $.grid.left']);
});

test('known-invalid: a misspelt key is a warning with a suggestion, never an error, while coverage is partial', () => {
	const result = validate({ series: [{ type: 'line', smoth: true }], xAxis: { type: 'category', dat: [] } });
	assert.equal(result.valid, true);
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.severity, d.path, d.suggestion]),
		[
			['CFG_UNKNOWN_KEY', 'warning', '$.series[0].smoth', 'Did you mean "smooth"?'],
			['CFG_UNKNOWN_KEY', 'warning', '$.xAxis.dat', 'Did you mean "data"?']
		]
	);
});

test('unknown: an extension series type is unresolved because RegisteredSeriesOption is declaration-merged', () => {
	for (const series of [[{ type: 'wordCloud', data: [] }], { type: 'liquidFill', data: [0.6] }]) {
		const result = validate({ series });
		assert.equal(result.valid, true);
		assert.deepEqual(
			result.diagnostics.map((d) => [d.code, d.severity]),
			[['CFG_UNKNOWN_VARIANT', 'warning']]
		);
	}
});

test('unknown: extension components at the root are accepted, the root is an open extension point', () => {
	const result = validate({
		bmap: { center: [120, 30], zoom: 5 },
		series: [{ type: 'scatter', coordinateSystem: 'bmap' }]
	});
	assert.equal(result.valid, true);
	assert.deepEqual(result.diagnostics, []);
});

test('context: subtypes the runtime picks by default or from data are resolved; visualMap stays inconclusive', () => {
	const codes = (option) => validate(option).diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`);
	assert.deepEqual(codes({ dataZoom: [{ type: 'inside' }, { start: 0 }], legend: {}, timeline: { data: [] } }), []);
	assert.deepEqual(codes({ xAxis: { data: ['a'], boundaryGap: true }, yAxis: { boundaryGap: [0, '5%'] } }), []);
	assert.deepEqual(codes({ xAxis: { data: [], boundaryGap: [0, 0] } }), ['CFG_TYPE error $.xAxis.boundaryGap']);
	assert.deepEqual(
		codes({ legend: { type: 'scroll', orient: 'vertical' }, dataZoom: { type: 'slider', show: false } }),
		[]
	);
	assert.deepEqual(codes({ visualMap: { min: 0, max: 10 } }), ['CFG_AMBIGUOUS info $.visualMap']);
});

test('the manifest is generated for the exact pinned version and stays partial', () => {
	const { manifest, lossy } = schema();
	assert.equal(manifest.version, '6.1.0');
	assert.equal(manifest.coverage, 'partial');
	assert.equal(manifest.source, 'echarts@6.1.0');
	assert.ok(lossy.length > 0);
	assert.equal(schema(), schema());
});

test('the shipped artifact is well-formed, so the adapter may skip the check at import time', () => {
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.equal(artifact.sources.echarts.license, 'Apache-2.0');
});
