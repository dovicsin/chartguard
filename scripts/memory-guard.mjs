import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A bound on the memory of every process a test run starts (E80). A test that runs away fails on its
 * own instead of taking the machine: a failing assertion on a large value makes Node's assert diff
 * what it prints of it with a typed array per step (memory that grows with its square, off the heap,
 * so `--max-old-space-size` does not bound it); half a million items took 40 GB of memory and swap
 * until the kernel killed the editor. Read from `/proc` (Linux, where CI runs); elsewhere the run
 * says that it is unguarded.
 */

/** Resident memory a test process may take, in bytes; the largest a run needs is shown after it. */
const MEMORY_LIMIT = 4 * 1024 ** 3;
/** How often the processes are read, in milliseconds (how far a runaway gets past the bound). */
const INTERVAL_MS = 200;

/** The parent and resident memory (bytes) of a process from its `status`, or undefined once it is gone. */
function statusOf(proc, pid) {
	let text;
	try {
		text = readFileSync(join(proc, pid, 'status'), 'utf8');
	} catch {
		return undefined;
	}
	const parent = /^PPid:\s+(\d+)$/mu.exec(text)?.[1];
	// A process without memory of its own (a zombie, a kernel thread) has no VmRSS line.
	const rss = /^VmRSS:\s+(\d+) kB$/mu.exec(text)?.[1];
	return parent === undefined ? undefined : { pid: Number(pid), parent: Number(parent), rss: Number(rss ?? 0) * 1024 };
}

/** Every process below `root` (itself included), with its resident memory, read from `proc`. */
export function processTree(root, proc = '/proc') {
	const all = readdirSync(proc)
		.filter((name) => /^\d+$/u.test(name))
		.map((pid) => statusOf(proc, pid))
		.filter((status) => status !== undefined);
	// Grouped by hand: Map.groupBy is not in Node 20, which the run supports.
	const children = new Map();
	for (const status of all) {
		const siblings = children.get(status.parent) ?? [];
		siblings.push(status);
		children.set(status.parent, siblings);
	}
	const tree = all.filter((status) => status.pid === root);
	for (let index = 0; index < tree.length; index++) tree.push(...(children.get(tree[index].pid) ?? []));
	return tree;
}

/**
 * What a process was started as, without its options, for the message that names it: a test file's
 * process carries every option Node expands for it (dozens), and its file is what names it.
 */
function commandOf(proc, pid) {
	try {
		return readFileSync(join(proc, String(pid), 'cmdline'), 'utf8')
			.split('\0')
			.filter((arg) => arg !== '' && !arg.startsWith('-'))
			.join(' ');
	} catch {
		return `process ${String(pid)}`;
	}
}

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

/**
 * One look at the processes below `root`: the largest is kept (`peak`, bytes, and its command), and
 * one over `limit` is killed and named, once. `read()` is what `guard` runs at every interval.
 */
export function watcher(
	root,
	{ limit = MEMORY_LIMIT, proc = '/proc', kill = (pid, signal) => process.kill(pid, signal) } = {}
) {
	const seen = { limit, peak: 0, command: '', killed: [] };
	const stopped = new Set();
	const read = () => {
		for (const { pid, rss } of processTree(root, proc)) {
			if (rss > seen.peak) Object.assign(seen, { peak: rss, command: commandOf(proc, pid) });
			if (rss <= limit || stopped.has(pid)) continue;
			stopped.add(pid);
			seen.killed.push(`${commandOf(proc, pid)} took ${gb(rss)} (bound ${gb(limit)})`);
			try {
				kill(pid, 'SIGKILL');
			} catch {
				// It ended between the read and the kill.
			}
		}
	};
	return { seen, read };
}

/** Watches the processes below `root` until `stop()`, which returns what was seen; unavailable without `/proc`. */
export function guard(root, { interval = INTERVAL_MS, ...options } = {}) {
	const { seen, read } = watcher(root, options);
	if (!existsSync(join(options.proc ?? '/proc', 'self', 'status'))) return { available: false, stop: () => seen };
	const timer = setInterval(read, interval);
	return {
		available: true,
		stop() {
			clearInterval(timer);
			return seen;
		}
	};
}

/** The lines a run ends with: what the guard saw, or that there was none. */
export function report({ available }, { limit, peak, command, killed }) {
	if (!available) return ['memory guard: unavailable here (no /proc); the run was not bounded'];
	return [
		...killed.map((line) => `memory guard: stopped ${line}`),
		`memory guard: largest test process ${gb(peak)} (bound ${gb(limit)}): ${command}`
	];
}
