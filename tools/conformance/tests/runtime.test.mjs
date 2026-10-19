import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';

import { KNOWN_VALID as CHARTJS_VALID } from '../../../packages/config/chartjs/tests/fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT as CHARTJS_CONTRACT } from '../../../packages/config/chartjs/tests/fixtures/runtime-contract.mjs';
import { TREE_SHAKEN_CONTRACT as CHARTJS_TREE_SHAKEN } from '../../../packages/config/chartjs/tests/fixtures/tree-shaken-contract.mjs';
import { KNOWN_VALID as ECHARTS_VALID } from '../../../packages/config/echarts/tests/fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT as ECHARTS_CONTRACT } from '../../../packages/config/echarts/tests/fixtures/runtime-contract.mjs';
import { TREE_SHAKEN_CONTRACT as ECHARTS_TREE_SHAKEN } from '../../../packages/config/echarts/tests/fixtures/tree-shaken-contract.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs, withChartjsModules } from '../lib/chartjs.mjs';
import { requiredExplanation } from '../lib/contract.mjs';
import { runEcharts, runEchartsModules } from '../lib/echarts.mjs';

/** `runModules(config, modules)`: the outcome on a runtime with only `modules` registered, and its registry context. */
const LIBRARIES = [
	{
		library: 'chartjs',
		run: runChartjs,
		runModules: (config, modules) =>
			withChartjsModules(modules, (registries) => ({ outcome: runChartjs(config), registries })),
		validate: validateChartjs,
		valid: CHARTJS_VALID,
		contract: [...CHARTJS_CONTRACT, ...CHARTJS_TREE_SHAKEN]
	},
	{
		library: 'echarts',
		run: runEcharts,
		runModules: runEchartsModules,
		validate: validateEcharts,
		valid: ECHARTS_VALID,
		contract: [...ECHARTS_CONTRACT, ...ECHARTS_TREE_SHAKEN]
	}
];

/** The runtime outcome plus everything it printed, so a failure shows why. */
function described(outcome) {
	return { verdict: verdictOf(outcome), threw: outcome.threw, messages: outcome.messages.map(({ text }) => text) };
}

const observed = (run, config) => described(run(config));

for (const { library, run, runModules, validate, valid, contract } of LIBRARIES) {
	for (const [name, config] of Object.entries(valid))
		test(`${library} known-valid renders silently: ${name}`, () => {
			const { verdict, threw, messages } = observed(run, config);
			assert.equal(verdict, 'accepted', JSON.stringify({ threw, messages }));
		});

	for (const entry of contract.filter(({ modules }) => modules !== undefined))
		test(`${library} tree-shaken findings match the registry the runtime reports: ${entry.name}`, () => {
			const { registries } = runModules(entry.config, entry.modules);
			const findings = validate(entry.config, { registries }).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
			assert.deepEqual(findings, entry.findings);
		});

	for (const entry of contract)
		test(`${library} runtime contract: ${entry.name}`, () => {
			const outcome = entry.modules === undefined ? run(entry.config) : runModules(entry.config, entry.modules).outcome;
			const { verdict, threw, messages } = described(outcome);
			assert.equal(verdict, entry.runtime, JSON.stringify({ threw, messages }));
			const prefix = requiredExplanation(entry);
			if (prefix === undefined) assert.equal(entry.why, undefined, 'an agreeing case needs no explanation');
			else assert.ok(entry.why?.startsWith(prefix), `expected why to start with "${prefix}"`);
		});
}

test('the explanation rule covers every combination', () => {
	const cases = [
		[['error CFG_TYPE $.a'], 'rejected', undefined],
		[['error CFG_TYPE $.a'], 'complained', undefined],
		[['error CFG_TYPE $.a'], 'accepted', 'Type contract:'],
		[['warning CFG_UNKNOWN_KEY $.a'], 'accepted', 'Unresolved:'],
		[['warning CFG_INEFFECTIVE $.a'], 'accepted', 'No effect:'],
		[['warning CFG_INEFFECTIVE $.a', 'warning CFG_UNKNOWN_KEY $.b'], 'accepted', 'Unresolved:'],
		[['warning CFG_UNKNOWN_VARIANT $.a'], 'rejected', 'Unresolved:'],
		[['info CFG_AMBIGUOUS $.a'], 'accepted', undefined],
		[['info CFG_AMBIGUOUS $.a'], 'rejected', 'False negative (CG-'],
		[[], 'accepted', undefined],
		[[], 'rejected', 'False negative (CG-']
	];
	for (const [findings, runtime, expected] of cases)
		assert.equal(requiredExplanation({ findings, runtime }), expected, JSON.stringify({ findings, runtime }));
});

test('the runners never change the config they are given; the runtimes write into what they receive', () => {
	const chartjs = { type: 'line', data: { labels: ['a'], datasets: [{ data: [1] }] }, options: { plugins: { tooltip: { callbacks: { label: () => 'x' } } } } };
	const echarts = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' }, series: [{ type: 'line', data: [1] }] };
	const snapshot = (value) => JSON.stringify(value);
	const [beforeChartjs, beforeEcharts] = [snapshot(chartjs), snapshot(echarts)];
	runChartjs(chartjs);
	runEcharts(echarts);
	assert.equal(snapshot(chartjs), beforeChartjs);
	assert.equal(snapshot(echarts), beforeEcharts);
});

test('a tree-shaken Chart.js run restores every built-in afterwards, even when the body throws', () => {
	const config = { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } };
	assert.throws(() => withChartjsModules(['LineController'], () => { throw new Error('body'); }), { message: 'body' });
	assert.equal(verdictOf(runChartjs(config)), 'accepted');
	assert.throws(() => withChartjsModules(['NotAModule'], () => 0), { message: 'not a chart.js registerable: NotAModule' });
	assert.equal(verdictOf(runChartjs(config)), 'accepted');
});

test('a tree-shaken ECharts run rejects what it cannot pass to a child process', () => {
	assert.throws(() => runEchartsModules({ series: [{ type: 'line', label: { formatter: () => '' } }] }, ['LineChart']), {
		message: 'a tree-shaken case must be plain JSON'
	});
	assert.throws(() => runEchartsModules({}, ['NoSuchChart']), /not an echarts chart or component: NoSuchChart/);
});
