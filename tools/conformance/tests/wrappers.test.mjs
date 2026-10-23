import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { createValidator } from '@chartguard/config-highcharts';
import { Chart } from 'chart.js';
import * as echarts from 'echarts';

import { guard, registriesOf as chartjsRegistries } from '../../../packages/integrations/chartjs-runtime/dist/index.js';
import {
	checkOption,
	registriesOf as echartsRegistries
} from '../../../packages/integrations/echarts-runtime/dist/index.js';
import { addSeries, checkUpdate, createChart } from '../../../packages/integrations/highcharts-runtime/dist/index.js';
import { createChartjs } from '../lib/chartjs.mjs';

/**
 * The contract every runtime wrapper keeps (CG-04-06): one validation per call, the caller's input
 * never changed and its getters never run, no global state left behind, and an overhead of its own
 * that stays small next to the validation it wraps.
 */
const LOCAL = fileURLToPath(new URL('../../../node_modules/.cache/chartguard/highcharts-13.1.1.json', import.meta.url));
const validateHighcharts = createValidator(JSON.parse(readFileSync(LOCAL, 'utf8')));
const points = (count) => Array.from({ length: count }, (_, index) => index);

/** A Highcharts chart in the state `update` matches against, and the namespace that created it. */
function highchartsChart() {
	const chart = {
		options: { chart: { type: 'line' } },
		series: [
			{ type: 'line', coll: 'series', userOptions: { type: 'line' }, options: {} },
			{ type: 'column', coll: 'series', userOptions: {}, options: {} }
		],
		get: () => undefined,
		update() {},
		addSeries: () => ({})
	};
	return { chart, highcharts: { version: '13.1.1', seriesTypes: { line: {}, column: {} }, chart: () => chart } };
}

/** One server-side echarts chart per option size, holding that option; disposed after the tests. */
const heldCharts = new Map();
test.after(() => {
	for (const chart of heldCharts.values()) chart.dispose();
});
const echartsOption = (count) => ({
	xAxis: { type: 'category', data: points(count) },
	yAxis: {},
	series: [{ type: 'line', data: points(count), smooth: true }]
});
/** The chart for an update of this size, holding a plain option built afresh: the update itself is never read here. */
function heldChart(input) {
	const size = Object.getOwnPropertyDescriptor(input, 'series').value[0].data.length;
	if (!heldCharts.has(size)) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		chart.setOption(echartsOption(size));
		heldCharts.set(size, chart);
	}
	return heldCharts.get(size);
}

/**
 * Each wrapper's checking path without the chart library drawing: `run(input, validator)` calls the
 * wrapper as an application would; `validator` is what it validates with, and `bare` (default:
 * `validator(input)`) the validation alone it is measured against.
 */
const WRAPPERS = [
	{
		name: 'runtime-chartjs guard (creation)',
		validator: validateChartjs,
		input: (count) => ({
			type: 'line',
			data: { labels: points(count), datasets: [{ label: 'a', data: points(count), borderWidth: 2 }] },
			options: { plugins: { legend: { position: 'top' } } }
		}),
		run(input, validator) {
			const plugin = guard(input, { validator, onResult: () => undefined }).plugins.at(-1);
			plugin.beforeInit({ constructor: Chart, config: {} });
		}
	},
	{
		name: 'runtime-echarts checkOption',
		validator: validateEcharts,
		input: echartsOption,
		// A live chart already holding an option of the same size: the update merges into it, and the
		// guard reads what it holds (`getOption()` clones all of it), as an application's update does (K5).
		run: (input, validator) => checkOption(heldChart(input), input, undefined, { validator, echarts })
	},
	{
		name: 'runtime-highcharts createChart',
		validator: validateHighcharts,
		input: (count) => ({ chart: { type: 'column' }, series: [{ type: 'line', data: points(count), lineWidth: 2 }] }),
		run: (input, validator) =>
			createChart(highchartsChart().highcharts, 'box', input, { validator, onResult: () => undefined })
	},
	{
		name: 'runtime-highcharts update',
		validator: validateHighcharts,
		input: (count) => ({ series: [{ data: points(count) }, { data: points(count), pointPadding: 0.1 }] }),
		run(input, validator) {
			const { chart, highcharts } = highchartsChart();
			createChart(highcharts, 'box', {}, { validator: validateHighcharts, onResult: () => undefined });
			checkUpdate(chart, input, {}, { validator });
		}
	},
	{
		name: 'runtime-highcharts addSeries',
		validator: validateHighcharts,
		input: (count) => ({ type: 'column', data: points(count), pointPadding: 0.1 }),
		// addSeries validates the series as `{ series: [options] }`.
		bare: (input) => validateHighcharts({ series: [input] }),
		run: (input, validator) => addSeries(highchartsChart().chart, input, {}, { validator, onResult: () => undefined })
	}
];

function deepFreeze(value) {
	if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
	Object.freeze(value);
	for (const key of Object.keys(value)) deepFreeze(value[key]);
	return value;
}

/** `value` with an enumerable getter beside every own property of every object and array, calling `onRead` when read. */
function withGetters(value, onRead) {
	if (typeof value !== 'object' || value === null) return value;
	const copy = Array.isArray(value)
		? value.map((item) => withGetters(item, onRead))
		: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withGetters(item, onRead)]));
	return Object.defineProperty(copy, 'planted', { enumerable: true, get: () => (onRead(), 1) });
}

const timed = (body) => {
	const start = performance.now();
	body();
	return performance.now() - start;
};

/** A fixed CPU task (sorting 200 000 numbers): the unit the absolute budget is measured in. */
const reference = () => {
	const numbers = Array.from({ length: 200_000 }, (_, index) => (index * 7919) % 200_003);
	return numbers.sort((a, b) => a - b)[0];
};

/**
 * The fastest of `runs` timings of each body, run in turn. For CPU-bound code the minimum is the
 * cost without interference (garbage collection, other test files, coverage); interleaving puts the
 * same interference on both sides. Time is a budget here, never a hang guard (E-rows).
 */
function fastest(bodies, runs = 15) {
	const best = bodies.map(() => Number.POSITIVE_INFINITY);
	for (let run = 0; run < runs; run += 1)
		bodies.forEach((body, index) => (best[index] = Math.min(best[index], timed(body))));
	return best;
}

/** What a wrapper could leave behind in this process: globals, built-in prototypes, console, the chart registries. */
function globalState() {
	const names = (object) => Object.getOwnPropertyNames(object).sort().join(',');
	return {
		globals: names(globalThis),
		prototypes: [Object.prototype, Array.prototype, Function.prototype, String.prototype].map(names),
		console: ['log', 'warn', 'error', 'info'].map((method) => globalThis.console[method]),
		chartjs: JSON.stringify(chartjsRegistries(Chart)),
		echarts: JSON.stringify(echartsRegistries(echarts))
	};
}

// Taken before any test runs: every wrapper call in this file happens after it.
const baseline = globalState();

for (const wrapper of WRAPPERS) {
	test(`${wrapper.name}: one validation per call`, () => {
		let calls = 0;
		wrapper.run(wrapper.input(10), (input, options) => ((calls += 1), wrapper.validator(input, options)));
		assert.equal(calls, 1);
	});

	test(`${wrapper.name}: a deeply frozen input is read, never written`, () => {
		const findings = [];
		const recording = (input, options) => {
			const result = wrapper.validator(input, options);
			findings.push(result.diagnostics.map((d) => `${d.code} ${d.path}`));
			return result;
		};
		wrapper.run(wrapper.input(10), recording);
		assert.doesNotThrow(() => wrapper.run(deepFreeze(wrapper.input(10)), recording));
		assert.deepEqual(findings[1], findings[0]);
	});

	test(`${wrapper.name}: a getter at any depth of the input is never run`, () => {
		let reads = 0;
		wrapper.run(
			withGetters(wrapper.input(10), () => (reads += 1)),
			wrapper.validator
		);
		assert.equal(reads, 0);
	});

	test(`${wrapper.name}: a 10 000-point chart is checked within its budget (3 reference units, about 100 ms)`, () => {
		const input = wrapper.input(10_000);
		// Measured against a fixed CPU task timed in turn with it, so load slows both alike. On the
		// maintainer's machine the task takes about 33 ms and the slowest check about 20 ms (0.6 units).
		const [checked, unit] = fastest([() => wrapper.run(input, wrapper.validator), reference], 5);
		assert.ok(checked <= 3 * unit, `${checked.toFixed(2)} ms against a reference of ${unit.toFixed(2)} ms`);
	});

	test(`${wrapper.name}: its own overhead stays small next to the validation (100 000 points)`, () => {
		const input = wrapper.input(100_000);
		const bodies = [() => (wrapper.bare ?? wrapper.validator)(input), () => wrapper.run(input, wrapper.validator)];
		// Budget: the wrapper adds at most half the validation time plus 2 ms (measured on the pinned runtimes).
		const within = ([bare, wrapped]) => wrapped <= bare * 1.5 + 2;
		// A spike shared by every run of one side (other test files, browsers) is measured again, longer:
		// only an overrun that persists is a regression.
		const first = fastest(bodies);
		const [bare, wrapped] = within(first) ? first : fastest(bodies, 40);
		assert.ok(within([bare, wrapped]), `wrapped ${wrapped.toFixed(2)} ms vs validation ${bare.toFixed(2)} ms`);
	});
}

test('a full lifecycle through every wrapper leaves no global state behind, and a destroyed chart leaves nothing registered', () => {
	for (const wrapper of WRAPPERS) wrapper.run(wrapper.input(10), wrapper.validator);
	const config = WRAPPERS[0].input(10);
	const chart = createChartjs(guard(config, { onResult: () => undefined }));
	chart.data.datasets[0].borderWidth = 3;
	chart.update();
	chart.destroy();
	assert.deepEqual(Object.keys(Chart.instances), []);
	assert.deepEqual(globalState(), baseline);
});

test('importing a runtime package changes no global, built-in prototype or console method (identity)', () => {
	const probe = `
		const names = (object) => Object.getOwnPropertyNames(object).sort().join(',');
		const state = () => JSON.stringify([names(globalThis), names(console), ...[Object.prototype, Array.prototype, Function.prototype].map(names)]);
		const methods = Object.getOwnPropertyNames(console);
		const before = { state: state(), methods: methods.map((name) => console[name]) };
		await import('@chartguard/runtime-chartjs');
		await import('@chartguard/runtime-echarts');
		await import('@chartguard/runtime-highcharts');
		const same = state() === before.state && methods.every((name, index) => console[name] === before.methods[index]);
		process.stdout.write(String(same));
	`;
	const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
		encoding: 'utf8',
		cwd: fileURLToPath(new URL('../../..', import.meta.url))
	});
	assert.equal(child.stdout, 'true', child.stderr);
});
