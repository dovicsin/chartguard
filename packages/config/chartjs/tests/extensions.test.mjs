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
const findings = (validator, config, options) =>
	validator(config, options).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

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

test('built-in plugins and scales cannot be replaced; a controller is added through controllers, not the registry name', () => {
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
		'x: no registry chartjs.controllers (known: chartjs.charts, chartjs.datasets, chartjs.scales)'
	]);
});

/** chartjs-chart-funnel-like: a funnel chart type and dataset type, built on bar. */
const FUNNEL = {
	id: 'funnel',
	controllers: {
		funnel: {
			extends: 'bar',
			dataset: s.object({ shrinkFraction: s.number() }),
			options: s.object({ funnelGap: s.number() })
		}
	}
};

test('a controller adds a chart type and a dataset type, both inheriting from the built-in they extend', () => {
	const validator = withExtensions([FUNNEL]);
	const funnel = (dataset, options = {}) => ({ type: 'funnel', data: { datasets: [dataset] }, options });
	// An untyped dataset of a funnel chart is a funnel dataset, as the runtime resolves it from the chart type.
	assert.deepEqual(findings(validator, funnel({ data: [1], shrinkFraction: 'x', barPercentage: 'y' })), [
		'error CFG_TYPE $.data.datasets[0].shrinkFraction',
		'error CFG_TYPE $.data.datasets[0].barPercentage'
	]);
	assert.deepEqual(findings(validator, funnel({ data: [1] }, { funnelGap: 'x', responsive: 'y' })), [
		'error CFG_TYPE $.options.funnelGap',
		'error CFG_TYPE $.options.responsive'
	]);
	// A typed funnel dataset in a built-in chart; a bar dataset in a funnel chart.
	assert.deepEqual(
		findings(validator, { type: 'line', data: { datasets: [{ type: 'funnel', data: [1], shrinkFraction: 'x' }] } }),
		['error CFG_TYPE $.data.datasets[0].shrinkFraction']
	);
	assert.deepEqual(
		findings(validator, funnel({ type: 'bar', data: [1], shrinkFraction: 1 })).map((finding) => finding.split(' ')[1]),
		['CFG_UNKNOWN_KEY']
	);
	assert.deepEqual(validator(funnel({ data: [1] })).extensions, ['funnel']);
	// Without the extension the chart type is an unknown variant, a warning.
	assert.deepEqual(findings(validate, funnel({ data: [1] })), ['warning CFG_UNKNOWN_VARIANT $.type']);
});

test('a controller redefines an option for its own chart type only; the built-in it extends keeps its own (K13, A32)', () => {
	const validator = withExtensions([
		{ id: 'x', controllers: { funnel: { extends: 'bar', options: s.object({ indexAxis: s.number() }) } } }
	]);
	assert.deepEqual(
		findings(validator, { type: 'funnel', data: { datasets: [{ data: [1] }] }, options: { indexAxis: 2 } }),
		[]
	);
	assert.deepEqual(
		findings(validator, { type: 'bar', data: { datasets: [{ data: [1] }] }, options: { indexAxis: 2 } }),
		['error CFG_TYPE $.options.indexAxis']
	);
	// Options that are not an object schema would add nothing: refused at setup.
	assert.throws(
		() => withExtensions([{ id: 'x', controllers: { funnel: { extends: 'bar', options: s.number() } } }]),
		(error) => {
			assert.ok(error instanceof ExtensionError);
			assert.deepEqual(error.problems, ['x: controller "funnel" options must be an object schema']);
			return true;
		}
	);
});

test('a controller must extend a built-in type, and its registration is the controllers registry', () => {
	assert.throws(
		() => withExtensions([{ id: 'x', controllers: { funnel: { extends: 'pyramid' } } }]),
		(error) => {
			assert.deepEqual(error.problems, [
				'x: "funnel" extends "pyramid", which is not a built-in variant of chartjs.charts',
				'x: "funnel" extends "pyramid", which is not a built-in variant of chartjs.datasets'
			]);
			return true;
		}
	);
	const validator = withExtensions([FUNNEL]);
	const registries = { registries: { 'chartjs.controllers': { names: ['bar'], complete: true } } };
	const config = { type: 'funnel', data: { datasets: [{ type: 'funnel', data: [1] }] } };
	assert.deepEqual(findings(validator, config, registries), ['error CFG_UNREGISTERED $.data.datasets[0].type']);
});
