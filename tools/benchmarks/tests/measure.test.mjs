import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { main } from '../bench.mjs';
import { fastest, judge, probe, probeResult } from '../lib/measure.mjs';
import { cold, project } from '../lib/probes.mjs';

test('the fastest of interleaved runs is kept for each body', () => {
	const costs = [
		[5, 3, 4],
		[9, 9, 2]
	];
	const calls = [0, 0];
	const clock = { now: 0 };
	const bodies = costs.map((list, index) => () => (clock.now += list[calls[index]++]));
	assert.deepEqual(
		fastest(bodies, 3, () => clock.now),
		[3, 2]
	);
	assert.deepEqual(calls, [3, 3], 'every body runs once per round');
});

test('a measurement over budget is measured again, longer, and fails only when the overrun persists', async () => {
	const runs = [];
	const spike = await judge(async (options) => (runs.push(options.runs), runs.length === 1 ? 5 : 1), 2);
	assert.deepEqual(spike, { value: 1, within: true });
	assert.ok(runs[1] > runs[0], `the second measurement is longer: ${String(runs)}`);
	const persistent = await judge(async () => 5, 2);
	assert.deepEqual(persistent, { value: 5, within: false });
	let measured = 0;
	assert.deepEqual(await judge(async () => ((measured += 1), 1), 2), { value: 1, within: true });
	assert.equal(measured, 1, 'a value within budget is measured once');
});

test("a child probe's output is checked in shape: anything else is an error, never a number", () => {
	const keys = ['ms', 'unit'];
	assert.deepEqual(probeResult('noise\n{"ms":3,"unit":30}\n', keys), { ms: 3, unit: 30 });
	for (const output of [
		'',
		'not json',
		'{"ms":3}',
		'{"ms":"3","unit":30}',
		'{"ms":-1,"unit":30}',
		'{"ms":3,"unit":0}',
		'[3,30]',
		'{"ms":3,"unit":30,"more":1}'
	])
		assert.throws(() => probeResult(output, keys), /probe/u, output);
});

test('bench prints every measurement with its budget and fails when one is over', async () => {
	const scenarios = [
		{ id: 'fast', unit: 'units', measure: async () => 0.5 },
		{ id: 'slow', unit: 'MB', measure: async () => 300 }
	];
	const budgets = { fast: { budget: 1, measured: 0.4 }, slow: { budget: 200, measured: 150 } };
	const lines = [];
	const out = (line) => lines.push(line);
	assert.equal(await main(['--json'], { scenarios, budgets, out }), 1);
	assert.deepEqual(JSON.parse(lines.join('\n')), [
		{ id: 'fast', unit: 'units', value: 0.5, budget: 1, within: true },
		{ id: 'slow', unit: 'MB', value: 300, budget: 200, within: false }
	]);
	lines.length = 0;
	assert.equal(await main([], { scenarios: scenarios.slice(0, 1), budgets, out }), 0);
	assert.match(lines.join('\n'), /fast\s+0\.50 units\s+budget 1 units\s+ok/u);
	const errors = [];
	assert.equal(await main(['--bogus'], { scenarios, budgets, out, err: (line) => errors.push(line) }), 2);
	assert.match(errors.join('\n'), /unknown option --bogus/u);
	assert.equal(
		await main([], { scenarios, budgets: { fast: budgets.fast }, out, err: (line) => errors.push(line) }),
		2
	);
	assert.match(errors.join('\n'), /no budget for slow/u);
});

test('the probes measure in this process too: a cold start, and a project removed after its check', async () => {
	const started = await cold('highcharts');
	assert.ok(started.ms > 0 && started.rss > 0 && started.unit > 0, JSON.stringify(started));
	const checked = await project('2');
	assert.equal(checked.findings, 1, 'the edit is checked: its wrong value is found');
	assert.ok(checked.open > 0 && checked.edit > 0, JSON.stringify(checked));
	assert.deepEqual(
		readdirSync(tmpdir()).filter((name) => name.startsWith('chartguard-bench-')),
		[]
	);
});

test('a probe that fails is an error naming it, never a number', () => {
	assert.throws(() => probe('no-such-probe', [], ['ms']), /the probe no-such-probe failed \(2\).*unknown probe/su);
});
