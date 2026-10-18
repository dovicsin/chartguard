import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact } from '@chartguard/config-core';

import { schema, validate } from '../dist/index.js';
import artifact from '../src/generated/echarts-6.1.0.json' with { type: 'json' };
import { KNOWN_VALID } from './fixtures/known-valid.mjs';

for (const [name, option] of Object.entries(KNOWN_VALID))
	test(`known-valid: ${name}`, () => {
		const result = validate(option);
		assert.equal(result.valid, true);
		assert.deepEqual(
			result.diagnostics.filter((d) => d.severity !== 'info'),
			[]
		);
	});

const report = (option) => validate(option).diagnostics.map((d) => `${d.severity}/${d.confidence} ${d.code} ${d.path}`);

test('known-invalid: wrong primitive types and undocumented enum values are confirmed errors', () => {
	assert.deepEqual(report({ series: [{ type: 'bar', data: [1], barWidth: true }] }), [
		'error/certain CFG_TYPE $.series[0].barWidth'
	]);
	assert.deepEqual(report({ series: [{ type: 'line', smooth: 'yes' }] }), [
		'error/certain CFG_TYPE $.series[0].smooth'
	]);
	assert.deepEqual(report({ series: { type: 'scatter', symbolSize: 'big' } }), [
		'error/certain CFG_TYPE $.series.symbolSize'
	]);
	assert.deepEqual(report({ title: { text: 42 } }), ['error/certain CFG_TYPE $.title.text']);
	assert.deepEqual(report({ tooltip: { trigger: 'hover' } }), ['error/certain CFG_ENUM $.tooltip.trigger']);
	assert.deepEqual(report({ xAxis: { type: 'catgory' } }), ['error/certain CFG_ENUM $.xAxis.type']);
	assert.deepEqual(report({ series: [{ type: 'bar', label: { position: 'middel' } }] }), [
		'error/certain CFG_ENUM $.series[0].label.position'
	]);
	assert.deepEqual(report({ animation: 'yes', darkMode: 'maybe' }), [
		'error/certain CFG_TYPE $.animation',
		'error/certain CFG_ENUM $.darkMode'
	]);
	assert.deepEqual(report({ xAxis: { type: 'value', boundaryGap: 'wide' } }), [
		'error/certain CFG_TYPE $.xAxis.boundaryGap'
	]);
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

test('unknown: components whose runtime subtype is chosen by default or by content are inconclusive, not guessed', () => {
	const codes = (option) => validate(option).diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`);
	assert.deepEqual(codes({ xAxis: { min: 'x' } }), ['CFG_AMBIGUOUS info $.xAxis']);
	assert.deepEqual(codes({ dataZoom: [{ type: 'inside' }, { start: 0 }] }), [
		'CFG_AMBIGUOUS info $.dataZoom[0]',
		'CFG_AMBIGUOUS info $.dataZoom[1]'
	]);
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
