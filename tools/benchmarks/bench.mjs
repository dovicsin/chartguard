import { runAsEntryPoint } from '../shared/entry.mjs';
import { BUDGETS } from './lib/budgets.mjs';
import { judge } from './lib/measure.mjs';

/** One line of the table: the measurement, its budget and whether it is within. */
const tableLine = ({ id, unit, value, budget, within }) =>
	`${id.padEnd(36)} ${value.toFixed(2)} ${unit}  budget ${String(budget)} ${unit}  ${within ? 'ok' : 'OVER'}`;

/** Why `argv` and the scenarios cannot be run, or undefined. */
function invocationProblem(argv, scenarios, budgets) {
	const unknown = argv.find((arg) => arg !== '--json');
	if (unknown !== undefined) return `unknown option ${unknown} (usage: bench [--json])`;
	const missing = scenarios.find((scenario) => budgets[scenario.id] === undefined);
	return missing === undefined ? undefined : `no budget for ${missing.id}`;
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

/** Where `main` writes by default. */
const STDIO = {
	out: (text) => process.stdout.write(`${text}\n`),
	err: (text) => process.stderr.write(`${text}\n`)
};

/**
 * `npm run bench` (CG-07-03): every scenario measured against its budget, as a table or `--json`.
 * Exit 1 when one is over budget after its re-measure, 2 for a malformed invocation or a scenario
 * without a budget.
 */
export async function main(argv, given = {}) {
	const { scenarios, budgets, out, err } = { budgets: BUDGETS, ...STDIO, ...given };
	// Imported only when measuring (a malformed invocation is refused first): the scenarios load every package.
	const measured =
		scenarios ?? (argv.every((arg) => arg === '--json') ? (await import('./lib/scenarios.mjs')).SCENARIOS : []);
	const problem = invocationProblem(argv, measured, budgets);
	if (problem !== undefined) {
		err(problem);
		return 2;
	}
	const results = await judgeAll(measured, budgets);
	if (argv.includes('--json'))
		out(JSON.stringify(results.map(({ id, unit, value, budget, within }) => ({ id, unit, value, budget, within }))));
	else results.forEach((result) => out(tableLine(result)));
	return results.every((result) => result.within) ? 0 : 1;
}

await runAsEntryPoint(import.meta.url, (argv) => main(argv));
