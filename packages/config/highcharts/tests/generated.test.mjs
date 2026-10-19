import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createValidator } from '../dist/index.js';
import { KNOWN_VALID } from './fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT } from './fixtures/runtime-contract.mjs';

/** Generated from the installed highcharts by `npm run build`; never committed (CG-01-05). */
const LOCAL = fileURLToPath(
	new URL('../../../../node_modules/.cache/chartguard/highcharts-13.1.1.json', import.meta.url)
);
const artifact = JSON.parse(readFileSync(LOCAL, 'utf8'));
const validate = createValidator(artifact);
const findings = (config, options) =>
	validate(config, options).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

for (const [name, config] of Object.entries(KNOWN_VALID))
	test(`generated schema, known-valid: ${name}`, () => {
		const result = validate(config);
		assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
		assert.deepEqual(
			result.diagnostics.filter((d) => d.severity !== 'info'),
			[]
		);
	});

for (const { name, config, findings: expected } of RUNTIME_CONTRACT)
	test(`generated schema, runtime contract: ${name}`, () => assert.deepEqual(findings(config), expected));

test('the result names the exact schema it came from', () => {
	const result = validate({});
	assert.deepEqual(
		[result.library, result.schemaVersion, result.schemaDigest],
		['highcharts', '13.1.1', artifact.digest]
	);
	assert.equal(result.status, 'partial');
});

test('known-invalid: closed types and enums inside series, axes and components are confirmed errors', () => {
	assert.deepEqual(
		findings({
			chart: { type: 'line', zooming: { type: 'xyz' } },
			credits: { enabled: 'no' },
			xAxis: { tickInterval: 'often' },
			series: [{ type: 'line', data: [1], lineWidth: 'thick' }]
		}),
		[
			'error CFG_ENUM $.chart.zooming.type',
			'error CFG_TYPE $.credits.enabled',
			'error CFG_TYPE $.xAxis.tickInterval',
			'error CFG_TYPE $.series[0].lineWidth'
		]
	);
});

test('null on an optional option is unset, as pick() reads it; a required option still needs a value', () => {
	assert.deepEqual(findings({ yAxis: { title: { text: null } }, chart: { plotBackgroundColor: null } }), []);
	assert.deepEqual(findings({ yAxis: { title: { text: 7 } } }), ['error CFG_TYPE $.yAxis.title.text']);
});

test('a series without type is checked as the chart type, or as line when the chart names none', () => {
	assert.deepEqual(findings({ chart: { type: 'pie' }, series: [{ data: [1], innerSize: true }] }), [
		'error CFG_TYPE $.series[0].innerSize'
	]);
	assert.deepEqual(findings({ series: [{ data: [1], step: 'sideways' }] }), ['error CFG_ENUM $.series[0].step']);
});

test('unknown: a chart type the schema does not know leaves its untyped series inconclusive', () => {
	assert.deepEqual(findings({ chart: { type: 'flame3d' }, series: [{ data: [1] }] }), [
		'info CFG_AMBIGUOUS $.series[0]'
	]);
});

test('unknown: a series type no built-in declares may come from a plugin and is unresolved, with a suggestion', () => {
	const [finding] = validate({ series: [{ type: 'linee', data: [1] }] }).diagnostics;
	assert.deepEqual(
		[finding.code, finding.severity, finding.suggestion],
		['CFG_UNKNOWN_VARIANT', 'warning', 'Did you mean "line"?']
	);
});

test('registries: a series type whose module is not loaded is rejected; a registered plugin series is an extension', () => {
	const loaded = (names, complete = true) => ({ registries: { 'highcharts.series': { names, complete } } });
	assert.deepEqual(findings({ series: [{ type: 'sankey', data: [] }] }, loaded(['line', 'pie'])), [
		'error CFG_UNREGISTERED $.series[0].type'
	]);
	assert.deepEqual(findings({ series: [{ type: 'flame3d', data: [] }] }, loaded(['flame3d'], false)), [
		'info CFG_REGISTERED_VARIANT $.series[0].type'
	]);
});

test('createValidator refuses a malformed artifact or one for another library', () => {
	assert.throws(() => createValidator({ irVersion: 1 }), /Invalid schema artifact/);
	const chartjs = JSON.parse(
		readFileSync(fileURLToPath(new URL('../../chartjs/src/generated/chartjs-4.5.1.json', import.meta.url)), 'utf8')
	);
	assert.throws(() => createValidator(chartjs), {
		message: 'Expected a highcharts schema artifact, got one for chartjs.'
	});
});
