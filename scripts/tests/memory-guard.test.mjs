import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { guard, processTree, report, watcher } from '../memory-guard.mjs';

/**
 * The test run's memory guard (E80): every process below the run is read, the largest kept, and one
 * over the bound killed and named, so a test that runs away fails instead of taking the machine.
 */
function fakeProc(t, processes) {
	const proc = mkdtempSync(join(tmpdir(), 'chartguard-proc-'));
	t.after(() => rmSync(proc, { recursive: true, force: true }));
	mkdirSync(join(proc, 'self'));
	writeFileSync(join(proc, 'self', 'status'), 'Name:\tself\nPPid:\t1\n');
	for (const { pid, parent, kb, command } of processes) {
		mkdirSync(join(proc, String(pid)));
		const rss = kb === undefined ? '' : `VmRSS:\t ${String(kb)} kB\n`;
		writeFileSync(join(proc, String(pid), 'status'), `Name:\tx (y)\nPPid:\t${String(parent)}\n${rss}`);
		writeFileSync(join(proc, String(pid), 'cmdline'), `${command}\0`);
	}
	return proc;
}

const PROCESSES = [
	{ pid: 10, parent: 1, kb: 1000, command: 'node --test' },
	{ pid: 11, parent: 10, kb: 2000, command: 'node a.test.mjs' },
	{ pid: 12, parent: 10, kb: 9000, command: 'node\0--test-isolation=process\0--stack-trace-limit=10\0b.test.mjs' },
	{ pid: 13, parent: 12, command: 'zombie' },
	{ pid: 14, parent: 13, kb: 500, command: 'chrome' },
	{ pid: 20, parent: 1, kb: 99_000, command: 'editor' }
];

test('the tree below a process: every descendant at any depth, with its resident memory; nothing beside it', (t) => {
	const proc = fakeProc(t, PROCESSES);
	const tree = processTree(10, proc);
	assert.deepEqual(
		tree.map(({ pid, rss }) => [pid, rss / 1024]).sort((a, b) => a[0] - b[0]),
		[
			[10, 1000],
			[11, 2000],
			[12, 9000],
			[13, 0],
			[14, 500]
		]
	);
});

test('a process over the bound is killed once and named; the largest is kept; others are left', (t) => {
	const proc = fakeProc(t, PROCESSES);
	const killed = [];
	const { seen, read } = watcher(10, { limit: 5000 * 1024, proc, kill: (pid, signal) => killed.push([pid, signal]) });
	read();
	read();
	assert.deepEqual(killed, [[12, 'SIGKILL']]);
	assert.equal(seen.peak, 9000 * 1024);
	// Named by its program and file, without the options Node expands for a test process.
	assert.equal(seen.command, 'node b.test.mjs');
	assert.equal(seen.killed.length, 1);
	assert.match(report({ available: true }, seen)[0], /^memory guard: stopped node b\.test\.mjs took 0\.01 GB/u);
	// A process that ended between the read and the kill is no failure of the guard.
	const gone = watcher(10, {
		limit: 0,
		proc,
		kill: () => {
			throw new Error('ESRCH');
		}
	});
	gone.read();
	// Every process with memory is over a bound of 0 (the zombie has none).
	assert.equal(gone.seen.killed.length, 4);
});

test('without /proc the run says it is unbounded, never silently', (t) => {
	const proc = mkdtempSync(join(tmpdir(), 'chartguard-proc-'));
	t.after(() => rmSync(proc, { recursive: true, force: true }));
	const watch = guard(1, { proc });
	assert.equal(watch.available, false);
	assert.deepEqual(report(watch, watch.stop()), ['memory guard: unavailable here (no /proc); the run was not bounded']);
});

test(
	'a real process that runs away off the heap is stopped at the bound',
	{ skip: process.platform !== 'linux' && 'reads /proc' },
	async () => {
		// Typed arrays, as Node's assert diff allocates them: outside the heap, so no heap flag bounds them.
		// It stops itself at 1 GB, so a guard that failed would cost the machine nothing.
		const child = spawn(process.execPath, [
			'-e',
			'const kept = []; const grow = () => { kept.push(new Int32Array(2 ** 23).fill(1)); if (kept.length < 32) setTimeout(grow, 10); }; grow(); setTimeout(() => {}, 5000);'
		]);
		const watch = guard(child.pid, { limit: 256 * 1024 ** 2, interval: 20 });
		const [code, signal] = await once(child, 'exit');
		const seen = watch.stop();
		assert.deepEqual([code, signal], [null, 'SIGKILL']);
		assert.equal(seen.killed.length, 1);
		assert.ok(seen.peak > 256 * 1024 ** 2 && seen.peak < 1024 ** 3, String(seen.peak));
	}
);
