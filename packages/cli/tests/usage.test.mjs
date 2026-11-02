import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { example, run } from './helpers.mjs';

const OK = example('chartjs-valid-subset.json');
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

/** A malformed invocation: exit 2, nothing on stdout, and stderr says what was wrong (C1, C4). */
async function rejects(argv, reason) {
	const { code, out, err } = await run(argv);
	assert.deepEqual([code, out], [2, ''], argv.join(' '));
	assert.match(err, /^ChartGuard: /, argv.join(' '));
	assert.match(err, reason, argv.join(' '));
	assert.match(err, /chartguard --help/);
	assert.doesNotMatch(err, /Exit codes:/, 'a short hint, not the whole usage');
}

test('a malformed invocation names what was wrong on stderr, not the usage on stdout', async () => {
	await rejects(
		['validate', '--library=chartjs', `--file=${OK}`, '--json=false'],
		/'--json' does not take an argument/
	);
	await rejects(['validate', '--library', 'chartjs', '--file', OK, '--file', OK], /--file .* more than once/);
	await rejects(['validate', '--library', 'chartjs', '--file', OK, '--', '--json'], /unexpected argument '--json'/);
	await rejects(['validate', '--library', 'chartjs', '--file', OK, '--bogus'], /'--bogus'/);
	await rejects(['validate', '--library', 'd3', '--file', OK], /unknown library 'd3'/);
	await rejects(['validate', '--file', OK], /--library is required/);
	await rejects(['validate', '--library', 'chartjs'], /validate reads exactly one --file/);
	await rejects(['frobnicate'], /unknown command 'frobnicate'/);
	await rejects(
		['validate', '--library', 'chartjs', '--file', OK, '--name', 'x'],
		/--name is not an option of validate/
	);
	await rejects(
		['quality', '--library', 'chartjs', '--file', OK, '--registries', 'r.json'],
		/--registries is not an option of quality/
	);
	await rejects(['schema', 'build', '--library', 'highcharts', '--file', OK], /--file is not an option of schema/);
	await rejects(['schema', 'make', '--library', 'highcharts'], /schema has one subcommand: build/);
	await rejects(['analyze', '--library', 'chartjs'], /analyze needs --file or --project/);
});

test('a duplicated scalar option is rejected, never silently the last one', async () => {
	await rejects(
		['validate', '--library', 'chartjs', '--library', 'echarts', '--file', OK],
		/--library is given more than once/
	);
	const json = await run(['validate', '--library', 'chartjs', '--file', OK, '--json', '--json']);
	assert.deepEqual([json.code, JSON.parse(json.out).error.message], [2, '--json is given more than once']);
	await rejects(
		['analyze', '--library', 'chartjs', '--file', OK, '--name', 'a', '--name', 'b'],
		/--name is given more than once/
	);
});

test('with --json a usage error is a JSON object on stdout', async () => {
	const { code, out, err } = await run(['validate', '--library', 'd3', '--file', OK, '--json']);
	assert.equal(code, 2);
	assert.deepEqual(JSON.parse(out), {
		error: { kind: 'usage', message: "unknown library 'd3' (chartjs, echarts or highcharts)" }
	});
	assert.match(err, /^ChartGuard: unknown library 'd3'/);
	// `--json` after `--` is an argument, not the option: no JSON is promised.
	assert.equal((await run(['validate', '--library', 'd3', '--', '--json'])).out, '');
});

test('with --json an input error is a JSON object on stdout too', async () => {
	const { code, out } = await run(['validate', '--library', 'chartjs', '--file', example('missing.json'), '--json']);
	assert.equal(code, 2);
	const { error } = JSON.parse(out);
	assert.equal(error.kind, 'input');
	assert.match(error.message, /missing\.json/);
});

test('--version prints the CLI package version', async () => {
	assert.deepEqual(await run(['--version']), { code: 0, out: VERSION, err: '' });
	await rejects(['--version', 'extra'], /--version takes no arguments/);
});
