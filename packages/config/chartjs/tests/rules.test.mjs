import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';

const ruled = (config, options) =>
	validate(config, options)
		.diagnostics.filter((d) => d.code === 'CFG_INEFFECTIVE' && d.path.endsWith('fill'))
		.map((d) => `${d.severity} ${d.confidence} ${d.path}`);
const withoutFiller = { registries: { 'chartjs.plugins': { names: ['legend', 'tooltip'], complete: true } } };
const withFiller = { registries: { 'chartjs.plugins': { names: ['filler'], complete: true } } };
const line = (dataset = {}, options) => ({
	type: 'line',
	data: { datasets: [{ data: [1], ...dataset }] },
	...(options === undefined ? {} : { options })
});

test('fill without the Filler plugin is ignored and warned about, wherever the dataset options resolve it from', () => {
	assert.deepEqual(ruled(line({ fill: true }), withoutFiller), ['warning certain $.data.datasets[0].fill']);
	assert.deepEqual(ruled(line({}, { datasets: { line: { fill: 'origin' } } }), withoutFiller), [
		'warning certain $.options.datasets.line.fill'
	]);
	assert.deepEqual(ruled(line({}, { fill: 'start' }), withoutFiller), ['warning certain $.options.fill']);
	const [finding] = validate(line({ fill: true }), withoutFiller).diagnostics.filter((d) => d.path.endsWith('fill'));
	assert.equal(
		finding.suggestion,
		'Register the Filler plugin (Chart.register(Filler)) and do not disable it in options.plugins.'
	);
});

test('a Filler disabled in options.plugins is not enabled either, also without a registry context', () => {
	assert.deepEqual(ruled(line({ fill: true }, { plugins: { filler: false } })), [
		'warning certain $.data.datasets[0].fill'
	]);
	assert.deepEqual(ruled(line({ fill: true }, { plugins: { filler: false } }), withFiller), [
		'warning certain $.data.datasets[0].fill'
	]);
});

test('no claim when the plugin is enabled, its state is unknown, or fill is falsy, a callback or unreadable', () => {
	assert.deepEqual(ruled(line({ fill: true }), withFiller), []);
	assert.deepEqual(ruled(line({ fill: true })), []);
	for (const fill of [false, 0, () => 'origin'])
		assert.deepEqual(ruled(line({ fill }), withoutFiller), [], String(fill));
	// Built directly: spreading the dataset into a helper would run the getter.
	const getter = Object.defineProperty({ data: [1] }, 'fill', { enumerable: true, get: () => true });
	assert.deepEqual(ruled({ type: 'line', data: { datasets: [getter] } }, withoutFiller), []);
	// The dataset's own falsy fill wins over a truthy one further up.
	assert.deepEqual(ruled(line({ fill: false }, { fill: true }), withoutFiller), []);
});

test('a fill set above the datasets is reported once, however many datasets inherit it', () => {
	const config = { type: 'line', data: { datasets: [{ data: [1] }, { data: [2] }] }, options: { fill: true } };
	assert.deepEqual(ruled(config, withoutFiller), ['warning certain $.options.fill']);
});
