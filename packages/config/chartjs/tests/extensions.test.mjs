import assert from 'node:assert/strict';
import test from 'node:test';

import { s } from '@chartguard/config-core';

import { ExtensionError, validate, withExtensions } from '../dist/index.js';

/** chartjs-plugin-datalabels and chartjs-plugin-streaming, as their users would describe them. */
const DATALABELS = {
	id: 'datalabels',
	options: { 'chartjs.plugins': { datalabels: s.object({ anchor: s.string(['center', 'start', 'end']) }) } }
};
const STREAMING = {
	id: 'streaming',
	variants: { 'chartjs.scales': { realtime: s.object({ realtime: s.object({ duration: s.number() }) }) } }
};
const bar = (options) => ({ type: 'bar', data: { datasets: [{ data: [1] }] }, options });
const findings = (validator, config) => validator(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

test('plugin options are checked at options.plugins of every chart type; unchecked without the extension', () => {
	const validator = withExtensions([DATALABELS]);
	for (const type of ['bar', 'line', 'doughnut'])
		assert.deepEqual(
			findings(validator, { ...bar({ plugins: { datalabels: { anchor: 'middle' } } }), type }),
			['error CFG_ENUM $.options.plugins.datalabels.anchor'],
			type
		);
	assert.deepEqual(findings(validate, bar({ plugins: { datalabels: { anchor: 'middle' } } })), []);
	assert.deepEqual(validator(bar({})).extensions, ['datalabels']);
});

test('a plugin scale is selected by its type and checked; without the extension it stays an unknown variant', () => {
	const validator = withExtensions([STREAMING]);
	const config = bar({ scales: { x: { type: 'realtime', realtime: { duration: 'long' } } } });
	assert.deepEqual(findings(validator, config), ['error CFG_TYPE $.options.scales.x.realtime.duration']);
	assert.deepEqual(findings(validate, config), ['warning CFG_UNKNOWN_VARIANT $.options.scales.x.type']);
});

test('built-in plugins and scales cannot be replaced, and controllers take no variants yet (part 2)', () => {
	const problems = (extension) => {
		try {
			withExtensions([extension]);
		} catch (error) {
			assert.ok(error instanceof ExtensionError);
			return error.problems;
		}
		return [];
	};
	assert.deepEqual(problems({ id: 'x', options: { 'chartjs.plugins': { legend: s.object({}) } } }), [
		'x: "legend" is a built-in option of chartjs.plugins and cannot be replaced'
	]);
	assert.deepEqual(problems({ id: 'x', variants: { 'chartjs.scales': { linear: s.object({}) } } }), [
		'x: "linear" is a built-in variant of chartjs.scales and cannot be replaced'
	]);
	assert.deepEqual(problems({ id: 'x', variants: { 'chartjs.controllers': { funnel: s.object({}) } } }), [
		'x: no registry chartjs.controllers (known: chartjs.scales)'
	]);
});
