import assert from 'node:assert/strict';
import test from 'node:test';

import { validate, withExtensions } from '@chartguard/config-chartjs';
import { Chart } from 'chart.js';

import { createChartjs } from '../../../../tools/conformance/lib/chartjs.mjs';
import { KNOWN_VALID } from '../../../config/chartjs/tests/fixtures/known-valid.mjs';
import { guard } from '../dist/index.js';

const bar = (options = {}) => ({
	type: 'bar',
	data: { labels: ['a'], datasets: [{ label: 'a', data: [1] }] },
	options
});
const findings = (result) =>
	result.diagnostics.filter((d) => d.severity !== 'info').map((d) => `${d.severity} ${d.code} ${d.path}`);

/** A live chart built from a guarded config, with every result and every draw recorded. */
function guarded(config, options = {}) {
	const results = [];
	let draws = 0;
	const counter = { id: 'draws', afterDraw: () => (draws += 1) };
	const withCounter = { ...config, plugins: [...(config.plugins ?? []), counter] };
	const chart = createChartjs(
		guard(withCounter, { onResult: (result, event) => results.push({ result, event }), ...options })
	);
	return { chart, results, draws: () => draws };
}

test("guard adds one plugin to a copy; the caller's config and plugins are not changed", () => {
	const plugins = [{ id: 'own' }];
	const config = { ...bar(), plugins };
	const result = guard(config);
	assert.notEqual(result, config);
	assert.deepEqual(
		result.plugins.map(({ id }) => id),
		['own', 'chartguard']
	);
	assert.equal(config.plugins, plugins);
	assert.deepEqual(
		plugins.map(({ id }) => id),
		['own']
	);
	assert.deepEqual(
		guard(bar()).plugins.map(({ id }) => id),
		['chartguard']
	);
});

test('at creation every known-valid config reports exactly what validate reports, with the running version', (t) => {
	for (const [name, config] of Object.entries(KNOWN_VALID)) {
		const { chart, results } = guarded(structuredCloneable(config));
		t.after(() => chart.destroy());
		const [created] = results;
		assert.deepEqual(created.event, { phase: 'create' }, name);
		assert.deepEqual(findings(created.result), findings(validate(config, { libraryVersion: Chart.version })), name);
	}
});

test('an invalid config is reported at creation, and with block it is not drawn', (t) => {
	const reported = guarded(bar({ responsive: 'yes' }));
	t.after(() => reported.chart.destroy());
	assert.deepEqual(findings(reported.results[0].result), ['error CFG_TYPE $.options.responsive']);
	assert.ok(reported.draws() > 0);
	const blocked = guarded(bar({ responsive: 'yes' }), { block: true });
	t.after(() => blocked.chart.destroy());
	assert.equal(blocked.draws(), 0);
});

test('without onResult, only a result with confirmed errors is warned, in one line', (t) => {
	const warned = t.mock.method(globalThis.console, 'warn', () => undefined);
	createChartjs(guard(bar({ responsive: 'yes' }))).destroy();
	createChartjs(guard(bar())).destroy();
	assert.equal(warned.mock.callCount(), 1);
	assert.match(
		String(warned.mock.calls[0].arguments[0]),
		/ChartGuard: chartjs config invalid at creation: \$\.options\.responsive/
	);
});

test('an update is validated from the live chart, without the scales Chart.js merged; with block a wrong one is not drawn', (t) => {
	const { chart, results, draws } = guarded(bar(), { block: true });
	t.after(() => chart.destroy());
	const drawn = draws();
	chart.data.datasets[0].borderWidth = 'wide';
	chart.update();
	const updated = results.at(-1);
	assert.equal(updated.event.phase, 'update');
	assert.deepEqual(findings(updated.result), ['error CFG_TYPE $.data.datasets[0].borderWidth']);
	assert.equal(draws(), drawn);
	chart.data.datasets[0].borderWidth = 2;
	chart.update();
	assert.equal(results.at(-1).result.valid, true);
	assert.ok(draws() > drawn);
});

test('an unchanged known-valid chart updates without a warning: its scales stand as checked at creation', (t) => {
	for (const [name, config] of Object.entries(KNOWN_VALID)) {
		const { chart, results } = guarded(structuredCloneable(config));
		t.after(() => chart.destroy());
		chart.update();
		const { result } = results.at(-1);
		const created = results[0].result.diagnostics.filter(({ path }) => path.startsWith('$.options.scales'));
		assert.deepEqual(
			findings(result),
			[
				...findings(validate(withoutScales(config), { libraryVersion: Chart.version })),
				...findings({ diagnostics: created })
			],
			name
		);
		assert.deepEqual(
			result.diagnostics.filter((d) => d.code === 'CFG_UNCHECKED'),
			[],
			name
		);
	}
});

test('with block, a chart created with an invalid scale stays undrawn at every update while its scales are unchanged (A46)', (t) => {
	const { chart, results, draws } = guarded(bar({ scales: { y: { type: 'linear', min: '50' } } }), { block: true });
	t.after(() => chart.destroy());
	assert.deepEqual(findings(results[0].result), ['error CFG_TYPE $.options.scales.y.min']);
	assert.equal(draws(), 0);
	// Another render of the same chart (a browser renders once on attach, then once more on creation) or a data change.
	chart.update('attach');
	chart.data.datasets[0].data = [2];
	chart.update();
	assert.equal(draws(), 0);
	assert.deepEqual(findings(results.at(-1).result), ['error CFG_TYPE $.options.scales.y.min']);
	assert.equal(results.at(-1).result.valid, false);
	// Once the scales change they cannot be checked at an update: not claimed invalid, noted unchecked.
	chart.options.scales.y.min = 0;
	chart.update();
	assert.ok(draws() > 0);
	assert.deepEqual(
		results
			.at(-1)
			.result.diagnostics.filter(({ code }) => code === 'CFG_UNCHECKED')
			.map(({ path }) => path),
		['$.options.scales']
	);
});

test('the state is per chart: a second chart, or one recreated after destroy, from the same guarded config is checked on its own (A46)', (t) => {
	const results = [];
	let draws = 0;
	const counter = { id: 'draws', afterDraw: () => (draws += 1) };
	const config = guard(
		{ ...bar({ scales: { y: { type: 'linear', min: '50' } } }), plugins: [counter] },
		{ block: true, onResult: (result, event) => results.push(event.phase) }
	);
	const first = createChartjs(config);
	first.update();
	first.destroy();
	const second = createChartjs(config);
	t.after(() => second.destroy());
	second.update();
	const third = createChartjs(config);
	t.after(() => third.destroy());
	assert.equal(draws, 0);
	assert.deepEqual(results, ['create', 'update', 'create', 'update', 'create']);
});

test('updates can be left unchecked, and a validator with extensions replaces the shipped one', (t) => {
	const quiet = guarded(bar(), { updates: false });
	t.after(() => quiet.chart.destroy());
	quiet.chart.update();
	assert.deepEqual(
		quiet.results.map(({ event }) => event.phase),
		['create']
	);
	// A plugin's option schema, written as the engine's schema nodes.
	const size = { kind: 'object', properties: { size: { kind: 'number' } }, required: [], additionalProperties: 'warn' };
	const labels = { id: 'labels', options: { 'chartjs.plugins': { labels: size } } };
	const extended = guarded(bar({ plugins: { labels: { size: 'big' } } }), { validator: withExtensions([labels]) });
	t.after(() => extended.chart.destroy());
	assert.deepEqual(findings(extended.results[0].result), ['error CFG_TYPE $.options.plugins.labels.size']);
	assert.deepEqual(extended.results[0].result.extensions, ['labels']);
});

/** A fresh copy of a fixture per chart: Chart.js writes into the config it receives. */
function structuredCloneable(config) {
	const copy = (value) => {
		if (Array.isArray(value)) return value.map(copy);
		if (value === null || typeof value !== 'object') return value;
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copy(entry)]));
	};
	return copy(config);
}

function withoutScales(config) {
	const options = Object.fromEntries(Object.entries(config.options ?? {}).filter(([key]) => key !== 'scales'));
	return { ...config, options };
}

test('the running Chart.js version is the one validated against, unless the caller names one', () => {
	const results = [];
	const plugin = (options) =>
		guard(bar({ responsive: 'yes' }), { onResult: (result) => results.push(result), ...options }).plugins.at(-1);
	// A chart as Chart.js hands it to a plugin, from another Chart.js release than the schema's.
	class OtherChart {
		static version = '4.4.0';
	}
	const chart = Object.assign(new OtherChart(), { config: bar() });
	plugin().beforeInit(chart);
	assert.deepEqual(
		results[0].diagnostics.map((d) => `${d.severity} ${d.code}`),
		['warning CFG_VERSION_MISMATCH', 'warning CFG_TYPE']
	);
	plugin({ options: { libraryVersion: '4.5.1' } }).beforeInit(chart);
	assert.deepEqual(
		results[1].diagnostics.map((d) => `${d.severity} ${d.code}`),
		['error CFG_TYPE']
	);
});

test('guard never runs a getter of the config, and checks it as given', () => {
	let reads = 0;
	const config = Object.defineProperty(bar(), 'options', {
		enumerable: true,
		get: () => ((reads += 1), { responsive: 'yes' })
	});
	const protectedConfig = guard(config, { onResult: () => undefined });
	assert.equal(reads, 0);
	const results = [];
	guard(config, { onResult: (result) => results.push(result) })
		.plugins.at(-1)
		.beforeInit(Object.assign(Object.create({ constructor: Chart }), { config: protectedConfig }));
	assert.equal(reads, 0);
	assert.deepEqual(
		results[0].diagnostics.map((d) => d.code),
		['CFG_DYNAMIC']
	);
});
