import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { main } from '../../packages/cli/bin/chartguard.mjs';
import { ActionInputError, argumentsOf, runAction } from '../run.mjs';

/** The GitHub Action (CG-06-08): its inputs as CLI arguments, and a run as a workflow sees it. */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const example = (name) => join(ROOT, 'examples', name);

test('inputs become CLI arguments, one argument per value: a pattern with spaces or an option in it stays one value', () => {
	assert.deepEqual(argumentsOf({}), ['validate']);
	assert.deepEqual(
		argumentsOf({
			INPUT_COMMAND: 'analyze',
			INPUT_LIBRARY: ' echarts ',
			INPUT_FILES: 'src/**/*.ts\n\n  charts/my chart.ts  \r\n',
			INPUT_IGNORE: '**/draft/**',
			INPUT_PROJECT: 'tsconfig.json',
			'INPUT_LIBRARY-VERSION': 'auto',
			'INPUT_FAIL-ON': 'warning',
			INPUT_CONFIG: 'ci/chartguard.json'
		}),
		[
			'analyze',
			'--library',
			'echarts',
			'--config',
			'ci/chartguard.json',
			'--library-version',
			'auto',
			'--project',
			'tsconfig.json',
			'--file',
			'src/**/*.ts',
			'--file',
			'charts/my chart.ts',
			'--ignore',
			'**/draft/**',
			'--fail-on',
			'warning'
		]
	);
	assert.deepEqual(argumentsOf({ INPUT_FILES: 'a.json --format json' }), [
		'validate',
		'--file',
		'a.json --format json'
	]);
});

test('an input outside its choices is refused with its name, before anything runs', () => {
	assert.throws(
		() => argumentsOf({ INPUT_COMMAND: 'schema' }),
		new ActionInputError('input command: "schema" is not one of validate, analyze, quality')
	);
	assert.throws(
		() => argumentsOf({ 'INPUT_FAIL-ON': 'always' }),
		/input fail-on: "always" is not one of error, warning, never/u
	);
});

/** A run of the action with the real CLI, in a fresh workspace with GitHub's output files. */
async function runIn(t, inputs) {
	const workspace = mkdtempSync(join(tmpdir(), 'chartguard-action-'));
	t.after(() => rmSync(workspace, { recursive: true, force: true }));
	const env = {
		GITHUB_WORKSPACE: workspace,
		GITHUB_OUTPUT: join(workspace, 'output'),
		GITHUB_STEP_SUMMARY: join(workspace, 'summary'),
		...inputs
	};
	for (const file of [env.GITHUB_OUTPUT, env.GITHUB_STEP_SUMMARY]) writeFileSync(file, '');
	const stdout = [];
	const stderr = [];
	const code = await runAction({ env, main, stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) });
	const read = (name) => readFileSync(join(workspace, name), 'utf8');
	return { code, stdout, stderr, read };
}

test('a run: annotations on stdout, the SARIF file, the exit code as an output and the summary in the job summary', async (t) => {
	const { code, stdout, read } = await runIn(t, {
		INPUT_LIBRARY: 'chartjs',
		INPUT_FILES: example('chartjs-invalid.json'),
		'INPUT_SARIF-FILE': 'chartguard.sarif'
	});
	assert.equal(code, 1);
	assert.ok(stdout.some((line) => line.startsWith('::error file=') && line.includes('CFG_TYPE')));
	assert.match(stdout.at(-1), /^ChartGuard: [1-9]\d* error\(s\)/u);
	const log = JSON.parse(read('chartguard.sarif'));
	assert.equal(log.version, '2.1.0');
	assert.ok(log.runs[0].results.some(({ ruleId }) => ruleId === 'CFG_TYPE'));
	assert.equal(read('output'), 'exit-code=1\n');
	assert.equal(read('summary'), `${stdout.at(-1)}\n`);
});

test('fail-on decides the step: never passes it with the findings still annotated', async (t) => {
	const { code, stdout, read } = await runIn(t, {
		INPUT_LIBRARY: 'chartjs',
		INPUT_FILES: example('chartjs-invalid.json'),
		'INPUT_FAIL-ON': 'never'
	});
	assert.equal(code, 0);
	assert.ok(stdout.some((line) => line.startsWith('::error ')));
	assert.equal(read('output'), 'exit-code=0\n');
});

test('unusable input fails the step with exit 2 and the reason; no SARIF is written for it', async (t) => {
	const { code, stderr, read } = await runIn(t, {
		INPUT_LIBRARY: 'chartjs',
		INPUT_FILES: 'no-such-dir/*.json',
		'INPUT_SARIF-FILE': 'x.sarif'
	});
	assert.equal(code, 2);
	assert.match(stderr.join('\n'), /^ChartGuard: /u);
	assert.throws(() => read('x.sarif'), /ENOENT/u);
	const refused = await runIn(t, { INPUT_COMMAND: 'build' });
	assert.equal(refused.code, 2);
	assert.match(refused.stderr[0], /^ChartGuard: input command: "build"/u);
	assert.equal(refused.read('output'), '');
});

test('action.yml hands every input it declares to the run, as an environment variable the script reads', () => {
	const action = parse(readFileSync(join(ROOT, 'action.yml'), 'utf8'));
	const run = action.runs.steps.find(({ id }) => id === 'run');
	const passed = Object.keys(run.env).map((name) => name.replace(/^INPUT_/u, '').toLowerCase());
	const elsewhere = ['chartguard-version', 'node-version'];
	assert.deepEqual([...passed, ...elsewhere].sort(), Object.keys(action.inputs).sort());
	const script = readFileSync(join(ROOT, 'action', 'run.mjs'), 'utf8');
	for (const name of passed) assert.ok(script.includes(`'${name}'`), name);
	for (const [name, value] of Object.entries(run.env))
		assert.equal(value, `\${{ inputs.${name.replace(/^INPUT_/u, '').toLowerCase()} }}`);
});

test('the workflow users copy runs the action with inputs it declares, and uploads the SARIF file it writes', () => {
	const action = parse(readFileSync(join(ROOT, 'action.yml'), 'utf8'));
	const workflow = parse(readFileSync(join(ROOT, 'examples', 'github', 'chartguard.yml'), 'utf8'));
	const steps = workflow.jobs.charts.steps;
	const step = steps.find(({ uses }) => uses?.startsWith('dovicsin/chartguard@'));
	for (const name of Object.keys(step.with)) assert.ok(name in action.inputs, name);
	const upload = steps.find(({ uses }) => uses?.startsWith('github/codeql-action/upload-sarif@'));
	assert.equal(upload.with.sarif_file, step.with['sarif-file']);
});
