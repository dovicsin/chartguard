import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * How ChartGuard's performance is measured (CG-07-03). Time is a budget here, never a hang guard
 * nor a result (E-rows): it is measured against a fixed CPU task timed in turn with it, so load on
 * the machine slows both alike, and an overrun is measured again before it counts.
 */

/** A fixed CPU task (sorting 200 000 numbers): the unit time budgets are measured in. */
export const reference = () => {
	const numbers = Array.from({ length: 200_000 }, (_, index) => (index * 7919) % 200_003);
	return numbers.sort((a, b) => a - b)[0];
};

/**
 * The fastest of `runs` timings of each body, run in turn. For CPU-bound code the minimum is the
 * cost without interference (garbage collection, other test files, coverage); interleaving puts the
 * same interference on both sides.
 */
export function fastest(bodies, runs = 15, now = () => performance.now()) {
	const best = bodies.map(() => Number.POSITIVE_INFINITY);
	for (let run = 0; run < runs; run += 1)
		bodies.forEach((body, index) => {
			const start = now();
			body();
			best[index] = Math.min(best[index], now() - start);
		});
	return best;
}

/** `fastest` for bodies that return a promise: each is awaited before the next starts. */
export async function fastestAsync(bodies, runs = 15, now = () => performance.now()) {
	const best = bodies.map(() => Number.POSITIVE_INFINITY);
	for (let run = 0; run < runs; run += 1)
		for (const [index, body] of bodies.entries()) {
			const start = now();
			await body();
			best[index] = Math.min(best[index], now() - start);
		}
	return best;
}

/** The time of `body` in reference units: the fastest of `runs` interleaved timings of each. */
export function inUnits(body, runs) {
	const [time, unit] = fastest([body, reference], runs);
	return time / unit;
}

/** Runs of a first measurement, and of the longer one an overrun gets before it counts. */
export const RUNS = 7;
const LONGER = 25;

/**
 * Whether `measure` stays within `budget`. A value over it is measured again with more runs: a spike
 * shared by every run of one measurement (other test files, browsers) passes, an overrun that
 * persists is a regression. The value is the lower of the two.
 */
export async function judge(measure, budget) {
	const first = await measure({ runs: RUNS });
	if (first <= budget) return { value: first, within: true };
	const value = Math.min(first, await measure({ runs: LONGER }));
	return { value, within: value <= budget };
}

/**
 * The result a probe printed as its last line: an object with exactly `keys`, each a finite number,
 * `unit` above zero and none below. Anything else is an error, never a number (a value crossing a
 * process boundary is checked in shape).
 */
export function probeResult(output, keys) {
	const last = output.trim().split('\n').at(-1) ?? '';
	let value;
	try {
		value = JSON.parse(last);
	} catch {
		throw new Error(`the probe printed no result: ${last}`);
	}
	const fits =
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		Object.keys(value).sort().join() === [...keys].sort().join() &&
		keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) &&
		(!keys.includes('unit') || value.unit > 0);
	if (!fits) throw new Error(`the probe printed ${last}, not {${keys.join(', ')}}`);
	return value;
}

const PROBES = fileURLToPath(new URL('probes.mjs', import.meta.url));

/**
 * Runs the probe `name` in a fresh process (a hang guard of 2 minutes) and returns its checked
 * result. The process runs as users run it: without the coverage instrumentation of `npm run check`,
 * which doubles what a fresh process spends compiling (TypeScript most).
 */
export function probe(name, args, keys) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([variable]) => variable !== 'NODE_V8_COVERAGE'));
	const run = spawnSync(process.execPath, [PROBES, name, ...args], { encoding: 'utf8', env, timeout: 120_000 });
	if (run.status !== 0)
		throw new Error(`the probe ${name} failed (${String(run.status ?? run.signal)}): ${run.stderr}`);
	return probeResult(run.stdout, keys);
}
