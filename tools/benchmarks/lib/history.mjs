import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

/**
 * Trends across commits (CG-07-03): a history of runs, one JSON line each (`label`, `date`, `node`,
 * `results` of `id`, `unit`, `value`), each new run compared with the runs before it. The budgets fail
 * a regression; a trend shows a rise that is still within its budget, and never fails a run.
 */

/** Runs a history keeps: about a quarter of a year of commits to main. */
export const KEEP = 100;
/** Runs before a value it is compared with (their median, so one slow run does not count). */
export const WINDOW = 5;
/**
 * Runs a drift needs before it: against fewer, a value is shown beside them but nothing is claimed
 * (the same code measured `server-start` at 4.3 and 8.4 units in two runs in a row).
 */
export const MIN_RUNS = 3;
/** A drift: more than 25 % over the median and more than a tenth of its budget (less is noise). */
const RATIO = 1.25;
const NOISE = 0.1;
/** A history is ours, small (KEEP lines); one this large is not one, and is not read (E-rows: bounded input). */
const MAX_BYTES = 4 * 1024 * 1024;

/** A history that cannot be read: the run is refused, nothing is measured nor written. */
export class HistoryError extends Error {}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasKeys = (value, keys) => isRecord(value) && Object.keys(value).sort().join() === [...keys].sort().join();

const isResult = (value) =>
	hasKeys(value, ['id', 'unit', 'value']) &&
	typeof value.id === 'string' &&
	typeof value.unit === 'string' &&
	typeof value.value === 'number' &&
	Number.isFinite(value.value) &&
	value.value >= 0;

/** Whether `value` is a run as `writeHistory` writes it (checked in shape: a file may have been edited). */
const isRun = (value) =>
	hasKeys(value, ['label', 'date', 'node', 'results']) &&
	typeof value.label === 'string' &&
	typeof value.date === 'string' &&
	typeof value.node === 'string' &&
	Array.isArray(value.results) &&
	value.results.every(isResult);

/** One line of a history, or a HistoryError naming it. */
function runOf(file, text, index) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		value = undefined;
	}
	if (!isRun(value))
		throw new HistoryError(`${file}, line ${String(index + 1)}: not a run as bench --history writes it`);
	return value;
}

/** The runs of the history in `file`, oldest first; none when there is no file yet. */
export function readHistory(file) {
	if (!existsSync(file)) return [];
	if (statSync(file).size > MAX_BYTES)
		throw new HistoryError(`${file}: over ${String(MAX_BYTES)} bytes, not a history`);
	const lines = readFileSync(file, 'utf8').split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines.map((text, index) => runOf(file, text, index));
}

/** Writes the last KEEP of `runs` to `file`, replacing it whole (a run that stops halfway leaves the old one). */
export function writeHistory(file, runs) {
	const partial = `${file}.partial`;
	writeFileSync(
		partial,
		runs
			.slice(-KEEP)
			.map((run) => `${JSON.stringify(run)}\n`)
			.join('')
	);
	renameSync(partial, file);
}

const major = (node) => node.split('.')[0];

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Each result compared with the median of its WINDOW latest values in `history` measured on the same
 * Node major as `node` (another major compiles and collects differently): `previous` (undefined with
 * none) and whether it drifted (never claimed against fewer than MIN_RUNS runs).
 */
export function trend(results, history, node, budgets) {
	const comparable = history.filter((run) => major(run.node) === major(node));
	return results.map(({ id, value }) => {
		const earlier = comparable.flatMap((run) => run.results.filter((result) => result.id === id).map((r) => r.value));
		if (earlier.length === 0) return { id, previous: undefined, drift: false };
		const window = earlier.slice(-WINDOW);
		const previous = median(window);
		const drift =
			window.length >= MIN_RUNS && value > previous * RATIO && value - previous > budgets[id].budget * NOISE;
		return { id, previous, drift };
	});
}
