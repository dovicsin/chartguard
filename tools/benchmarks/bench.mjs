import { runAsEntryPoint } from '../shared/entry.mjs';
import { BUDGETS } from './lib/budgets.mjs';
import { HistoryError, readHistory, trend, writeHistory } from './lib/history.mjs';
import { judge } from './lib/measure.mjs';

const USAGE = 'usage: bench [--json] [--history <file> --label <name>]';

/** One line of the table: the measurement, its budget, whether it is within, and its trend when recorded. */
function tableLine({ id, unit, value, budget, within, previous, drift }) {
	const line = `${id.padEnd(36)} ${value.toFixed(2)} ${unit}  budget ${String(budget)} ${unit}  ${within ? 'ok' : 'OVER'}`;
	if (drift === undefined) return line;
	return `${line}  ${previous === undefined ? 'no earlier run' : `was ${previous.toFixed(2)}${drift ? '  DRIFT' : ''}`}`;
}

/** The options of `argv`, or the reason it is malformed (each option at most once, a value never an option). */
function parsed(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!['--json', '--history', '--label'].includes(arg)) return { problem: `unknown option ${arg} (${USAGE})` };
		if (Object.hasOwn(options, arg)) return { problem: `${arg} is given more than once` };
		if (arg === '--json') options[arg] = true;
		else {
			const value = argv[index + 1];
			if (value === undefined || value.startsWith('--')) return { problem: `${arg} needs a value (${USAGE})` };
			options[arg] = value;
			index += 1;
		}
	}
	if ((options['--history'] === undefined) !== (options['--label'] === undefined))
		return { problem: `--history and --label go together (${USAGE})` };
	return { json: options['--json'] === true, history: options['--history'], label: options['--label'] };
}

/** The runs recorded before this one, or the reason they cannot be read. */
function earlierRuns(history) {
	if (history === undefined) return { runs: [] };
	try {
		return { runs: readHistory(history) };
	} catch (error) {
		if (error instanceof HistoryError) return { problem: error.message };
		throw error;
	}
}

/** Each scenario judged against its budget, in turn (measurements in parallel would disturb each other). */
async function judgeAll(scenarios, budgets) {
	const results = [];
	for (const { id, unit, measure } of scenarios) {
		const { budget } = budgets[id];
		results.push({ id, unit, ...(await judge(measure, budget)), budget });
	}
	return results;
}

/** The results with their trend, the run appended to the history (when one is kept). */
function recorded(results, { history, label }, runs, budgets) {
	if (history === undefined) return results;
	const node = process.versions.node;
	const trends = trend(results, runs, node, budgets);
	const run = {
		label,
		date: new Date().toISOString(),
		node,
		results: results.map(({ id, unit, value }) => ({ id, unit, value }))
	};
	writeHistory(history, [...runs, run]);
	return results.map((result, index) => ({ ...result, previous: trends[index].previous, drift: trends[index].drift }));
}

/** What a run needs before it measures (options, earlier runs, scenarios with budgets), or why it is refused. */
async function prepared(argv, scenarios, budgets) {
	const options = parsed(argv);
	if (options.problem !== undefined) return { problem: options.problem };
	const earlier = earlierRuns(options.history);
	if (earlier.problem !== undefined) return { problem: earlier.problem };
	// Imported only when measuring (a malformed invocation is refused first): the scenarios load every package.
	const measured = scenarios ?? (await import('./lib/scenarios.mjs')).SCENARIOS;
	const missing = measured.find(({ id }) => budgets[id] === undefined);
	if (missing !== undefined) return { problem: `no budget for ${missing.id}` };
	return { options, runs: earlier.runs, measured };
}

/** Where `main` writes by default. */
const STDIO = {
	out: (text) => process.stdout.write(`${text}\n`),
	err: (text) => process.stderr.write(`${text}\n`)
};

const forMachines = ({ id, unit, value, budget, within, previous, drift }) =>
	drift === undefined ? { id, unit, value, budget, within } : { id, unit, value, budget, within, previous, drift };

/**
 * `npm run bench` (CG-07-03): every scenario measured against its budget, as a table or `--json`.
 * `--history <file> --label <name>` records the run under its name (a commit) and compares each value
 * with the runs before it (see `lib/history.mjs`); a drift is shown, never a failure. Exit 1 when one
 * is over budget after its re-measure, 2 for a malformed invocation or history, or a scenario
 * without a budget: then nothing is measured nor written.
 */
export async function main(argv, given = {}) {
	const { scenarios, budgets, out, err } = { budgets: BUDGETS, ...STDIO, ...given };
	const { problem, options, runs, measured } = await prepared(argv, scenarios, budgets);
	if (problem !== undefined) {
		err(problem);
		return 2;
	}
	const results = recorded(await judgeAll(measured, budgets), options, runs, budgets);
	if (options.json) out(JSON.stringify(results.map(forMachines)));
	else results.forEach((result) => out(tableLine(result)));
	return results.every((result) => result.within) ? 0 : 1;
}

await runAsEntryPoint(import.meta.url, (argv) => main(argv));
