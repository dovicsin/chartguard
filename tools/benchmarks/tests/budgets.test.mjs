import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { BUDGETS } from '../lib/budgets.mjs';
import { judge } from '../lib/measure.mjs';
import { SCENARIOS } from '../lib/scenarios.mjs';

/**
 * The performance gate (CG-07-03, E77): every scenario within its tracked budget. Time is measured in
 * reference units and an overrun is measured again before it fails (see `judge`), so load on the
 * machine does not fail it; a regression that persists does.
 */
test('the budgets name exactly the scenarios', () => {
	assert.deepEqual(Object.keys(BUDGETS).sort(), SCENARIOS.map((scenario) => scenario.id).sort());
});

for (const scenario of SCENARIOS) {
	test(`${scenario.id} stays within its budget`, async () => {
		const { budget } = BUDGETS[scenario.id];
		const { value, within } = await judge(scenario.measure, budget);
		assert.ok(within, `${scenario.id}: ${value.toFixed(2)} ${scenario.unit} against a budget of ${String(budget)}`);
	});
}

test('the project scenario leaves no temporary directory behind', () => {
	assert.deepEqual(
		readdirSync(tmpdir()).filter((name) => name.startsWith('chartguard-bench-')),
		[]
	);
});
