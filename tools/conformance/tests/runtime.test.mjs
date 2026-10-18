import assert from 'node:assert/strict';
import test from 'node:test';

import { KNOWN_VALID as CHARTJS_VALID } from '../../../packages/config/chartjs/tests/fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT as CHARTJS_CONTRACT } from '../../../packages/config/chartjs/tests/fixtures/runtime-contract.mjs';
import { KNOWN_VALID as ECHARTS_VALID } from '../../../packages/config/echarts/tests/fixtures/known-valid.mjs';
import { RUNTIME_CONTRACT as ECHARTS_CONTRACT } from '../../../packages/config/echarts/tests/fixtures/runtime-contract.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';
import { requiredExplanation } from '../lib/contract.mjs';
import { runEcharts } from '../lib/echarts.mjs';

const LIBRARIES = [
	{ library: 'chartjs', run: runChartjs, valid: CHARTJS_VALID, contract: CHARTJS_CONTRACT },
	{ library: 'echarts', run: runEcharts, valid: ECHARTS_VALID, contract: ECHARTS_CONTRACT }
];

/** The runtime outcome plus everything it printed, so a failure shows why. */
function observed(run, config) {
	const outcome = run(config);
	return { verdict: verdictOf(outcome), threw: outcome.threw, messages: outcome.messages.map(({ text }) => text) };
}

for (const { library, run, valid, contract } of LIBRARIES) {
	for (const [name, config] of Object.entries(valid))
		test(`${library} known-valid renders silently: ${name}`, () => {
			const { verdict, threw, messages } = observed(run, config);
			assert.equal(verdict, 'accepted', JSON.stringify({ threw, messages }));
		});

	for (const entry of contract)
		test(`${library} runtime contract: ${entry.name}`, () => {
			const { verdict, threw, messages } = observed(run, entry.config);
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
		[['warning CFG_UNKNOWN_VARIANT $.a'], 'rejected', 'Unresolved:'],
		[['info CFG_AMBIGUOUS $.a'], 'accepted', undefined],
		[['info CFG_AMBIGUOUS $.a'], 'rejected', 'False negative (CG-'],
		[[], 'accepted', undefined],
		[[], 'rejected', 'False negative (CG-']
	];
	for (const [findings, runtime, expected] of cases)
		assert.equal(requiredExplanation({ findings, runtime }), expected, JSON.stringify({ findings, runtime }));
});
