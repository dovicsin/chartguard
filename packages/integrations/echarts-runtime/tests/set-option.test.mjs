import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '@chartguard/config-echarts';
import * as echarts from 'echarts';

import { KNOWN_VALID } from '../../../config/echarts/tests/fixtures/known-valid.mjs';
import { checkOption, setOption } from '../dist/index.js';

const AXES = { xAxis: { type: 'category', data: ['a'] }, yAxis: {} };
const LINE = { ...AXES, series: [{ type: 'line', data: [1] }] };
const errors = (result) => result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`);

/** A live server-side chart, disposed after the test; `errors` collects what echarts logs. */
function chartFor(t, first) {
	const logged = t.mock.method(globalThis.console, 'error', () => undefined);
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	t.after(() => chart.dispose());
	if (first !== undefined) chart.setOption(first);
	return { chart, logged: () => logged.mock.calls.map((call) => call.arguments.join(' ')) };
}
const quiet = { onResult: () => undefined };

test('a fresh option needs a type on every series: echarts drops one without it', (t) => {
	const { chart, logged } = chartFor(t);
	const option = { ...AXES, series: [{ type: 'line', data: [1] }, { data: [2] }] };
	assert.deepEqual(errors(checkOption(chart, option)), ['CFG_REQUIRED $.series[1].type']);
	chart.setOption(option);
	assert.deepEqual(
		chart.getOption().series.map(({ type }) => type),
		['line']
	);
	assert.ok(logged().some((line) => line.includes('Unknown series')));
	// A single series object, and a timeline's base option.
	assert.deepEqual(errors(checkOption(chartFor(t).chart, { series: { data: [1] } })), ['CFG_REQUIRED $.series.type']);
	assert.deepEqual(errors(checkOption(chartFor(t).chart, { baseOption: { series: [{ data: [1] }] } })), [
		'CFG_REQUIRED $.baseOption.series[0].type'
	]);
});

test('notMerge and replaceMerge of series make an option fresh again', (t) => {
	const { chart } = chartFor(t, LINE);
	const untyped = { ...AXES, series: [{ data: [2] }] };
	assert.deepEqual(errors(checkOption(chart, untyped, true)), ['CFG_REQUIRED $.series[0].type']);
	assert.deepEqual(errors(checkOption(chart, untyped, { notMerge: true })), ['CFG_REQUIRED $.series[0].type']);
	assert.deepEqual(errors(checkOption(chart, untyped, { replaceMerge: ['series'] })), [
		'CFG_REQUIRED $.series[0].type'
	]);
	assert.deepEqual(errors(checkOption(chart, untyped, { replaceMerge: 'series' })), ['CFG_REQUIRED $.series[0].type']);
	assert.deepEqual(errors(checkOption(chart, untyped, { replaceMerge: ['xAxis'] })), []);
});

test('a merge update takes the type of the series it merges into, and its contents are checked against it', (t) => {
	const { chart } = chartFor(t, LINE);
	assert.deepEqual(errors(checkOption(chart, { series: [{ data: [2], smooth: 'yes' }] })), [
		'CFG_TYPE $.series[0].smooth'
	]);
	// A merge leaves out what the chart already has (the axes): what a rule would claim about it is unresolved, never an error.
	const partial = checkOption(chart, { series: [{ data: [2] }] });
	const claims = partial.diagnostics
		.filter((d) => d.code === 'CFG_REQUIRES')
		.map((d) => `${d.severity} ${d.confidence}`);
	assert.deepEqual([...new Set(claims)], ['warning unknown']);
	assert.equal(partial.valid, true);
	// More untyped items than the chart has series: echarts drops the extra one.
	const extra = { series: [{ data: [2] }, { data: [3] }] };
	assert.deepEqual(errors(checkOption(chart, extra)), ['CFG_REQUIRED $.series[1].type']);
	chart.setOption(extra);
	// The series count shows the drop; echarts logs "Unknown series" once per process (E28), and an earlier test did.
	assert.equal(chart.getOption().series.length, 1);
	// With a name or an id, echarts matches by its own rules: nothing is claimed.
	const named = checkOption(chart, { series: [{ name: 'b', data: [9] }, { data: [3] }] });
	assert.deepEqual(errors(named), []);
	assert.ok(named.diagnostics.some((d) => d.code === 'CFG_AMBIGUOUS'));
});

test('every known-valid option set on a fresh chart reports what validate reports', (t) => {
	for (const [name, option] of Object.entries(KNOWN_VALID)) {
		const { chart } = chartFor(t);
		const checked = setOption(chart, option, undefined, quiet);
		assert.deepEqual(checked.diagnostics, validate(option).diagnostics, name);
	}
});

test('setOption applies the option with its settings unless blocked, never changes it, and runs no getter', (t) => {
	const { chart } = chartFor(t, LINE);
	const option = { series: [{ data: [2], smooth: 'yes' }] };
	const before = JSON.stringify(option);
	const blocked = setOption(chart, option, undefined, { ...quiet, block: true });
	assert.equal(blocked.valid, false);
	assert.deepEqual(chart.getOption().series[0].data, [1]);
	assert.equal(JSON.stringify(option), before);
	setOption(chart, { series: [{ data: [5] }] }, { lazyUpdate: true }, quiet);
	assert.deepEqual(chart.getOption().series[0].data, [5]);
	setOption(chart, { ...LINE, series: [{ type: 'bar', data: [7] }] }, true, quiet);
	assert.deepEqual(
		chart.getOption().series.map(({ type }) => type),
		['bar']
	);
	let reads = 0;
	const getter = Object.defineProperty({}, 'series', { enumerable: true, get: () => ((reads += 1), [{ data: [1] }]) });
	checkOption(chart, getter);
	assert.equal(reads, 0);
});

test('without onResult only a result with confirmed errors is warned; onResult says whether the option was fresh', (t) => {
	const { chart } = chartFor(t);
	const warned = t.mock.method(globalThis.console, 'warn', () => undefined);
	setOption(chart, { series: [{ data: [1] }] });
	setOption(chart, LINE);
	assert.equal(warned.mock.callCount(), 1);
	assert.match(String(warned.mock.calls[0].arguments[0]), /ChartGuard: echarts option invalid: \$\.series\[0\]\.type/);
	const events = [];
	setOption(chart, { series: [{ data: [3] }] }, undefined, { onResult: (_, event) => events.push(event) });
	setOption(chart, LINE, true, { onResult: (_, event) => events.push(event) });
	assert.deepEqual(events, [{ fresh: false }, { fresh: true }]);
});

test('a merge maps items to series as echarts does: an item that is not an object takes no series (K3)', (t) => {
	const { chart } = chartFor(t, {
		...AXES,
		series: [
			{ type: 'line', data: [1] },
			{ type: 'bar', data: [2] }
		]
	});
	// `null` is skipped: the next item merges into the first series, the line, not the bar. (The schema
	// still reports the `null` item itself, which echarts ignores.)
	const update = { series: [null, { smooth: 'yes' }] };
	assert.deepEqual(errors(checkOption(chart, update)), ['CFG_TYPE $.series[0]', 'CFG_TYPE $.series[1].smooth']);
	chart.setOption(update);
	assert.deepEqual(
		chart.getOption().series.map(({ type, smooth }) => [type, smooth]),
		[
			['line', 'yes'],
			['bar', undefined]
		]
	);
	// A bar option merged into the line series would be a line option the runtime ignores; checked as a line.
	assert.deepEqual(
		errors(checkOption(chart, { series: [0, 'x', { barWidth: true }] })).filter((line) => !/\[[01]\]$/u.test(line)),
		[]
	);
	// Items beyond the series the chart has, after skipped ones, are new: without a type they are dropped.
	assert.deepEqual(errors(checkOption(chart, { series: [null, {}, {}, {}] })), [
		'CFG_TYPE $.series[0]',
		'CFG_REQUIRED $.series[3].type'
	]);
});

test('a disposed chart sets nothing: no claim that a series is dropped (K4)', (t) => {
	const { chart } = chartFor(t, LINE);
	chart.dispose();
	t.mock.method(globalThis.console, 'warn', () => undefined);
	assert.equal(chart.getOption(), null);
	const result = checkOption(chart, { series: [{ data: [2] }, { data: [3] }] });
	assert.deepEqual(errors(result), []);
	assert.deepEqual(errors(setOption(chart, { series: [{ smooth: 'yes', type: 'line' }] }, undefined, quiet)), [
		'CFG_TYPE $.series[0].smooth'
	]);
});

test('the chart option is read once per call: getOption clones all of it (K5)', (t) => {
	const { chart } = chartFor(t, LINE);
	const reads = t.mock.method(chart, 'getOption');
	setOption(chart, { series: [{ data: [2] }] }, undefined, quiet);
	assert.equal(reads.mock.callCount(), 1);
	checkOption(chart, { series: [{ data: [2] }] });
	assert.equal(reads.mock.callCount(), 2);
});
