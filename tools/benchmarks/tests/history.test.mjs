import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { main } from '../bench.mjs';
import { BUDGETS, EDITOR_BUDGETS } from '../lib/budgets.mjs';
import { HistoryError, KEEP, MIN_RUNS, readHistory, trend, WINDOW, writeHistory } from '../lib/history.mjs';

/** Trends across commits (CG-07-03): each run recorded with its label, compared with the runs before it. */
const directory = (t) => {
	const made = mkdtempSync(join(tmpdir(), 'chartguard-history-'));
	t.after(() => rmSync(made, { recursive: true, force: true }));
	return made;
};
const record = (label, value, node = process.versions.node) => ({
	label,
	date: '2026-11-04T10:00:00.000Z',
	node,
	results: [{ id: 'fast', unit: 'units', value }]
});

test('a history is read in shape, line by line: a missing file is empty, anything malformed an error naming its line', (t) => {
	const root = directory(t);
	const file = join(root, 'history.jsonl');
	assert.deepEqual(readHistory(file), []);
	writeFileSync(file, `${JSON.stringify(record('a', 1))}\n${JSON.stringify(record('b', 2))}\n`);
	assert.deepEqual(
		readHistory(file).map(({ label }) => label),
		['a', 'b']
	);
	for (const [line, text] of [
		[1, 'not json'],
		[1, '[]'],
		[1, JSON.stringify({ ...record('a', 1), label: 3 })],
		[1, JSON.stringify({ ...record('a', 1), results: [{ id: 'fast', unit: 'units', value: -1 }] })],
		[1, JSON.stringify({ ...record('a', 1), results: [{ id: 'fast', unit: 'units', value: '1' }] })],
		[1, JSON.stringify({ ...record('a', 1), extra: true })],
		[2, `${JSON.stringify(record('a', 1))}\n{}`]
	]) {
		writeFileSync(file, line === 2 ? text : `${text}\n`);
		assert.throws(
			() => readHistory(file),
			(error) => error instanceof HistoryError && error.message.includes(`line ${String(line)}`),
			text
		);
	}
});

test('a value is compared with the median of the runs before it on the same Node major; a drift is a rise beyond noise', () => {
	const budgets = { fast: { budget: 1, measured: 0.25 } };
	const history = [
		record('old', 9, '22.10.0'),
		...[0.2, 0.3, 0.25, 0.9, 0.22].map((value, index) => record(`r${String(index)}`, value, '22.11.0')),
		record('other node', 9, '20.19.0')
	];
	const result = (value) => [{ id: 'fast', unit: 'units', value }];
	// The last WINDOW runs on Node 22: 0.2, 0.3, 0.25, 0.9, 0.22 (the 9 before them is older, the other on Node 20).
	assert.equal(WINDOW, 5);
	assert.deepEqual(trend(result(0.26), history, '22.12.0', budgets), [{ id: 'fast', previous: 0.25, drift: false }]);
	// More than 25 % up and more than a tenth of the budget: a drift.
	assert.deepEqual(trend(result(0.4), history, '22.12.0', budgets), [{ id: 'fast', previous: 0.25, drift: true }]);
	// A rise within a tenth of the budget is noise, whatever its ratio.
	const tiny = { fast: { budget: 1, measured: 0.01 } };
	const small = [0.01, 0.01, 0.01].map((value) => record('s', value, '22.11.0'));
	assert.deepEqual(trend(result(0.05), small, '22.12.0', tiny), [{ id: 'fast', previous: 0.01, drift: false }]);
	// Fewer than MIN_RUNS runs before it: shown beside them, no drift claimed however far it rose.
	assert.equal(MIN_RUNS, 3);
	const two = [0.2, 0.2].map((value) => record('t', value, '22.11.0'));
	assert.deepEqual(trend(result(0.9), two, '22.12.0', budgets), [{ id: 'fast', previous: 0.2, drift: false }]);
	// No run before it on this Node major: nothing to compare.
	assert.deepEqual(trend(result(5), history, '24.1.0', budgets), [{ id: 'fast', previous: undefined, drift: false }]);
});

test('a history keeps its last runs only', (t) => {
	const file = join(directory(t), 'history.jsonl');
	const runs = Array.from({ length: KEEP + 3 }, (_, index) => record(String(index), 1));
	writeHistory(file, runs);
	const kept = readHistory(file);
	assert.equal(kept.length, KEEP);
	assert.equal(kept[0].label, '3');
	assert.equal(readFileSync(file, 'utf8').endsWith('\n'), true);
});

test('bench --history records the run under its label and prints each trend; a drift does not fail it', async (t) => {
	const file = join(directory(t), 'history.jsonl');
	const scenarios = [{ id: 'fast', unit: 'units', measure: async () => 0.5 }];
	const budgets = { fast: { budget: 1, measured: 0.25 } };
	writeHistory(
		file,
		['a', 'b', 'before'].map((label) => record(label, 0.25))
	);
	const lines = [];
	const out = (line) => lines.push(line);
	assert.equal(await main(['--history', file, '--label', 'abc123'], { scenarios, budgets, out }), 0);
	assert.match(lines.join('\n'), /fast\s+0\.50 units\s+budget 1 units\s+ok\s+was 0\.25\s+DRIFT/u);
	const recorded = readHistory(file);
	assert.deepEqual(
		recorded.map(({ label, results }) => [label, results]),
		[
			['a', [{ id: 'fast', unit: 'units', value: 0.25 }]],
			['b', [{ id: 'fast', unit: 'units', value: 0.25 }]],
			['before', [{ id: 'fast', unit: 'units', value: 0.25 }]],
			['abc123', [{ id: 'fast', unit: 'units', value: 0.5 }]]
		]
	);
	assert.equal(recorded[3].node, process.versions.node);
	lines.length = 0;
	assert.equal(await main(['--json', '--label', 'next', '--history', file], { scenarios, budgets, out }), 0);
	assert.deepEqual(JSON.parse(lines.join('\n')), [
		{ id: 'fast', unit: 'units', value: 0.5, budget: 1, within: true, previous: 0.25, drift: true }
	]);
});

test('bench names what is wrong with its invocation, and measures nothing', async (t) => {
	const file = join(directory(t), 'history.jsonl');
	let measured = 0;
	const scenarios = [{ id: 'fast', unit: 'units', measure: async () => (measured += 1) }];
	const budgets = { fast: { budget: 1, measured: 0.25 } };
	const refused = async (argv, reason) => {
		const errors = [];
		assert.equal(await main(argv, { scenarios, budgets, out: () => {}, err: (line) => errors.push(line) }), 2);
		assert.match(errors.join('\n'), reason, argv.join(' '));
	};
	await refused(['--history', file], /--history and --label go together/u);
	await refused(['--label', 'a'], /--history and --label go together/u);
	await refused(['--history'], /--history needs a value/u);
	await refused(['--history', file, '--label', '--json'], /--label needs a value/u);
	await refused(['--label', 'a', '--label', 'b', '--history', file], /--label is given more than once/u);
	await refused(['--json', '--json'], /--json is given more than once/u);
	await refused(['--bogus'], /unknown option --bogus/u);
	assert.equal(measured, 0);
});

test('bench refuses a history it cannot read, and neither measures nor writes', async (t) => {
	const file = join(directory(t), 'history.jsonl');
	writeFileSync(file, 'broken\n');
	let measured = 0;
	const scenarios = [{ id: 'fast', unit: 'units', measure: async () => (measured += 1) }];
	const errors = [];
	const given = {
		scenarios,
		budgets: { fast: { budget: 1, measured: 0.25 } },
		out: () => {},
		err: (line) => errors.push(line)
	};
	assert.equal(await main(['--history', file, '--label', 'a'], given), 2);
	assert.match(errors.join('\n'), /history\.jsonl, line 1/u);
	assert.equal(measured, 0);
	assert.equal(readFileSync(file, 'utf8'), 'broken\n');
});

test('the VS Code budgets are their own, each above what it was set from', () => {
	for (const [id, { budget, measured }] of Object.entries(EDITOR_BUDGETS)) {
		assert.match(id, /^vscode-/u);
		assert.equal(Object.hasOwn(BUDGETS, id), false, id);
		assert.ok(budget > measured, id);
	}
});
