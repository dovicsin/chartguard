import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createValidator, validate } from '@chartguard/config-highcharts';

import { KNOWN_VALID } from '../../../config/highcharts/tests/fixtures/known-valid.mjs';
import { addSeries, checkUpdate, createChart, registriesOf, update } from '../dist/index.js';

/** Generated from the installed highcharts by `npm run build`; never committed (CG-01-05). */
const LOCAL = fileURLToPath(
	new URL('../../../../node_modules/.cache/chartguard/highcharts-13.1.1.json', import.meta.url)
);
const generated = createValidator(JSON.parse(readFileSync(LOCAL, 'utf8')));
const full = { validator: generated, onResult: () => undefined };
const quiet = { onResult: () => undefined };
const findings = (result) => result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

/** A Highcharts namespace whose constructors record their calls. */
function namespace(version = '13.1.1') {
	const created = [];
	const factory = (name) => (container, options) => {
		created.push({ name, container, options });
		return { name };
	};
	return { version, chart: factory('chart'), stockChart: factory('stockChart'), created };
}

/** A chart in the state `chart.update` matches against (the shape the browser test records), recording its calls. */
function chartOf({ chartType = 'line', series = [], others = {} } = {}) {
	const calls = [];
	const chart = {
		options: { chart: { type: chartType } },
		series: series.map(({ type, own, id, internal }) => ({
			type,
			coll: 'series',
			userOptions: own === undefined ? {} : { type: own },
			options: { id, isInternal: internal }
		})),
		get: (id) => chart.series.find((item) => item.options.id === id) ?? others[id],
		update: (...args) => calls.push(['update', ...args]),
		addSeries: (...args) => (calls.push(['addSeries', ...args]), { added: true })
	};
	return { chart, calls };
}
/** A column chart with an own-typed line series `a` and an untyped (column) series. */
const MIXED = { chartType: 'column', series: [{ type: 'line', own: 'line', id: 'a' }, { type: 'column' }] };

test('createChart validates for the running version, then creates with the chosen constructor', () => {
	const highcharts = namespace();
	const seen = [];
	const options = { series: [{ type: 'line', data: [1] }] };
	const { chart, result } = createChart(highcharts, 'box', options, {
		validator: (input, settings) => (seen.push(settings), validate(input, settings))
	});
	assert.deepEqual(chart, { name: 'chart' });
	assert.equal(result.valid, true);
	assert.deepEqual(seen, [{ libraryVersion: '13.1.1' }]);
	assert.deepEqual(highcharts.created, [{ name: 'chart', container: 'box', options }]);
	createChart(highcharts, 'box', options, { ...quiet, factory: 'stockChart', options: { libraryVersion: '12.0.0' } });
	assert.equal(highcharts.created[1].name, 'stockChart');
	assert.throws(() => createChart(highcharts, 'box', options, { factory: 'ganttChart' }), {
		name: 'TypeError',
		message: 'Highcharts.ganttChart is not loaded.'
	});
});

test('createChart with block creates nothing for invalid options; it never changes them or runs a getter', () => {
	const highcharts = namespace();
	const options = { chart: { type: 7 }, series: [{ data: [1] }] };
	const before = JSON.stringify(options);
	const { chart, result } = createChart(highcharts, 'box', options, { ...full, block: true });
	assert.equal(chart, undefined);
	assert.equal(result.valid, false);
	assert.deepEqual(highcharts.created, []);
	assert.equal(JSON.stringify(options), before);
	let reads = 0;
	const getter = Object.defineProperty({}, 'series', { enumerable: true, get: () => ((reads += 1), []) });
	createChart(highcharts, 'box', getter, quiet);
	assert.equal(reads, 0);
});

test('the shipped curated schema describes 13.x, so for the running version its errors are warnings', () => {
	const { result } = createChart(namespace(), 'box', { chart: { type: 7 } }, quiet);
	assert.equal(result.valid, true);
	assert.ok(result.diagnostics.some((d) => d.code === 'CFG_VERSION_MISMATCH'));
});

test('every known-valid fixture created through createChart reports what validate reports', () => {
	for (const [name, options] of Object.entries(KNOWN_VALID)) {
		const { result } = createChart(namespace(), 'box', options, quiet);
		assert.deepEqual(result.diagnostics, validate(options, { libraryVersion: '13.1.1' }).diagnostics, name);
	}
});

test('an update item is checked as the type of the series it reaches by index', () => {
	const { chart } = chartOf(MIXED);
	const change = { series: [{ data: [1] }, { data: [2], groupPadding: 'x' }] };
	// Validated alone, the untyped item would be a line series: column options are only unknown keys.
	assert.deepEqual(findings(generated(change, { incomplete: true })), [
		'warning CFG_UNKNOWN_KEY $.series[1].groupPadding'
	]);
	assert.deepEqual(findings(checkUpdate(chart, change, {}, full)), ['error CFG_TYPE $.series[1].groupPadding']);
	// The line series keeps its own type: a column option on it is still unknown.
	assert.deepEqual(findings(checkUpdate(chart, { series: [{ groupPadding: 0.1 }] }, {}, full)), [
		'warning CFG_UNKNOWN_KEY $.series[0].groupPadding'
	]);
	// `index` chooses the series; a single series object is item 0.
	assert.deepEqual(findings(checkUpdate(chart, { series: [{ index: 1, groupPadding: 'x' }] }, {}, full)), [
		'error CFG_TYPE $.series[0].groupPadding'
	]);
	assert.deepEqual(findings(checkUpdate(chart, { series: { groupPadding: 0.1 } }, {}, full)), [
		'warning CFG_UNKNOWN_KEY $.series.groupPadding'
	]);
});

test("the update's chart type applies to the series without their own", () => {
	const { chart } = chartOf(MIXED);
	const change = { chart: { type: 'line' }, series: [{}, { groupPadding: 0.1 }] };
	assert.deepEqual(findings(checkUpdate(chart, change, {}, full)), [
		'warning CFG_UNKNOWN_KEY $.series[1].groupPadding'
	]);
});

test('an item that reaches no series is ignored without oneToOne, and added with the chart type with it', () => {
	const { chart } = chartOf(MIXED);
	const extra = { series: [{}, {}, { groupPadding: 'x' }] };
	assert.deepEqual(findings(checkUpdate(chart, extra, {}, full)), ['warning CFG_INEFFECTIVE $.series[2]']);
	assert.equal(checkUpdate(chart, extra, {}, full).valid, true);
	assert.deepEqual(findings(checkUpdate(chart, extra, { oneToOne: true }, full)), [
		'error CFG_TYPE $.series[2].groupPadding'
	]);
	// An id the chart does not have, while the series at that index has another id: none.
	assert.deepEqual(findings(checkUpdate(chart, { series: [{ id: 'b' }] }, {}, full)), [
		'warning CFG_INEFFECTIVE $.series[0]'
	]);
	assert.deepEqual(findings(checkUpdate(chart, { series: [{ id: 'b' }] }, { oneToOne: true }, full)), []);
	// An internal series (the navigator's) is never reached by index.
	const internal = chartOf({ series: [{ type: 'line', internal: true }] }).chart;
	assert.deepEqual(findings(checkUpdate(internal, { series: [{}] }, {}, full)), [
		'warning CFG_INEFFECTIVE $.series[0]'
	]);
});

test('an item reaches a series by id through chart.get; an id of another kind of item is ignored even with oneToOne', () => {
	const { chart } = chartOf({ ...MIXED, others: { x: { coll: 'xAxis' } } });
	assert.deepEqual(findings(checkUpdate(chart, { series: [{}, { id: 'a', groupPadding: 0.1 }] }, {}, full)), [
		'warning CFG_UNKNOWN_KEY $.series[1].groupPadding'
	]);
	assert.deepEqual(findings(checkUpdate(chart, { series: [{ id: 'x' }] }, { oneToOne: true }, full)), [
		'warning CFG_INEFFECTIVE $.series[0]'
	]);
});

test('an id or index behind a getter claims nothing, and the getter does not run', () => {
	const { chart } = chartOf(MIXED);
	let reads = 0;
	const item = Object.defineProperty({ groupPadding: 'x' }, 'id', { enumerable: true, get: () => ((reads += 1), 'a') });
	const at = Object.defineProperty({}, 'index', { enumerable: true, get: () => ((reads += 1), 5) });
	const result = checkUpdate(chart, { series: [{}, {}, item, at] }, {}, full);
	assert.equal(reads, 0);
	assert.deepEqual(
		findings(result).filter((line) => line.includes('CFG_INEFFECTIVE')),
		[]
	);
});

test('update passes its settings on unless blocked, never changes the options, and uses the remembered version', () => {
	const { chart, calls } = chartOf(MIXED);
	const highcharts = { version: '13.1.1', chart: () => chart };
	const seen = [];
	const validator = (input, settings) => (seen.push(settings), generated(input, settings));
	createChart(highcharts, 'box', { series: [] }, { ...quiet, validator });
	const options = { series: [{}, { groupPadding: 'x' }] };
	const before = JSON.stringify(options);
	const blocked = update(chart, options, {}, { ...quiet, validator, block: true });
	assert.equal(blocked.valid, false);
	assert.deepEqual(calls, []);
	assert.equal(JSON.stringify(options), before);
	update(chart, { title: { text: 'x' } }, { redraw: false, oneToOne: true, animation: { duration: 0 } }, quiet);
	assert.deepEqual(calls, [['update', { title: { text: 'x' } }, false, true, { duration: 0 }]]);
	assert.deepEqual(seen.at(-1), { libraryVersion: '13.1.1', incomplete: true });
});

test('addSeries checks the series with the chart type when it has none, then adds it unless blocked', () => {
	const { chart, calls } = chartOf(MIXED);
	const added = addSeries(chart, { data: [1], groupPadding: 'x' }, {}, { ...full, block: true });
	assert.deepEqual(findings(added.result), ['error CFG_TYPE $.series[0].groupPadding']);
	assert.equal(added.series, undefined);
	assert.deepEqual(calls, []);
	const line = addSeries(chart, { type: 'line', data: [1], groupPadding: 0.1 }, { redraw: false }, full);
	assert.deepEqual(findings(line.result), ['warning CFG_UNKNOWN_KEY $.series[0].groupPadding']);
	assert.deepEqual(line.series, { added: true });
	assert.deepEqual(calls, [['addSeries', { type: 'line', data: [1], groupPadding: 0.1 }, false, undefined]]);
});

test('without onResult only a result with confirmed errors is warned, naming the call', (t) => {
	const warned = t.mock.method(globalThis.console, 'warn', () => undefined);
	const { chart } = chartOf(MIXED);
	update(chart, { series: [{}, {}, {}] }, {}, { validator: generated });
	createChart(namespace(), 'box', { chart: { type: 7 } }, { validator: generated });
	assert.equal(warned.mock.callCount(), 1);
	assert.match(
		String(warned.mock.calls[0].arguments[0]),
		/^ChartGuard: highcharts options invalid at create: \$\.chart\.type/
	);
	const events = [];
	addSeries(chart, { data: [1] }, {}, { onResult: (_, event) => events.push(event) });
	assert.deepEqual(events, [{ phase: 'addSeries' }]);
});

test('registriesOf reads the series types a live Highcharts has; without them there is no context', () => {
	assert.deepEqual(registriesOf({ seriesTypes: { line: {}, column: {}, area: {} } }), {
		'highcharts.series': { names: ['area', 'column', 'line'], complete: true }
	});
	assert.deepEqual(registriesOf({}), {});
	assert.deepEqual(registriesOf({ seriesTypes: null }), {});
	const bundled = Object.defineProperty({}, 'seriesTypes', { get: () => ({ line: {} }) });
	assert.deepEqual(registriesOf(bundled), { 'highcharts.series': { names: ['line'], complete: true } });
});

test('every call checks against the series types Highcharts has at that moment; a registry the caller names wins', () => {
	const seriesTypes = { line: {}, column: {} };
	const { chart } = chartOf(MIXED);
	const highcharts = { version: '13.1.1', seriesTypes, chart: () => chart };
	const sankey = { series: [{ type: 'sankey', keys: ['from', 'to', 'weight'], data: [['a', 'b', 1]] }] };
	const created = createChart(highcharts, 'box', sankey, { ...full, block: true });
	assert.deepEqual(findings(created.result), ['error CFG_UNREGISTERED $.series[0].type']);
	assert.equal(created.chart, undefined);
	const named = { ...full, options: { registries: { 'highcharts.series': { names: [], complete: false } } } };
	assert.deepEqual(findings(createChart(highcharts, 'box', sankey, named).result), []);
	// The sankey module loads after the chart was created: the next update knows it.
	assert.deepEqual(findings(addSeries(chart, sankey.series[0], {}, full).result), [
		'error CFG_UNREGISTERED $.series[0].type'
	]);
	seriesTypes.sankey = {};
	assert.deepEqual(findings(addSeries(chart, sankey.series[0], {}, full).result), []);
	assert.deepEqual(
		findings(checkUpdate(chart, { series: [{}, {}, { type: 'arearange' }] }, { oneToOne: true }, full)),
		['error CFG_UNREGISTERED $.series[2].type']
	);
});
