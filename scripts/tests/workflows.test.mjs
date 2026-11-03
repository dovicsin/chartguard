import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

/** E46: every workflow runs with least privilege and bounded, read on the syntax tree of its YAML. */
const WORKFLOWS = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

/**
 * The write scopes a job may ask for, by what it does: deploying Pages (CG-06-06 part 4), uploading
 * SARIF to code scanning (the users' workflow, CG-06-08).
 */
const JOB_WRITES = new Set(['pages', 'id-token', 'security-events']);

/** Whether a permissions block only reads: an object of `read`/`none` scopes. */
const readsOnly = (permissions) =>
	permissions !== null &&
	typeof permissions === 'object' &&
	Object.values(permissions).every((scope) => scope === 'read' || scope === 'none');

/** One job's problems: no timeout, a blanket permission, a write scope it does not need. */
function jobProblems(name, id, job) {
	const problems = typeof job['timeout-minutes'] === 'number' ? [] : [`${name}: job ${id} has no timeout-minutes`];
	if (typeof job.permissions === 'string')
		return [...problems, `${name}: job ${id} sets permissions to ${job.permissions}`];
	for (const [scope, level] of Object.entries(job.permissions ?? {}))
		if (level === 'write' && !JOB_WRITES.has(scope)) problems.push(`${name}: job ${id} writes ${scope}`);
	return problems;
}

/** Problems of one parsed workflow, `name` naming it in each. */
function workflowProblems(name, workflow) {
	const problems = readsOnly(workflow.permissions) ? [] : [`${name}: top-level permissions must be read-only`];
	const jobs = Object.entries(workflow.jobs ?? {}).flatMap(([id, job]) => jobProblems(name, id, job));
	return [...problems, ...jobs];
}

test('every workflow is read-only at the top, bounded per job, and writes only what deploying Pages needs', () => {
	const files = readdirSync(WORKFLOWS).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
	assert.ok(files.includes('ci.yml') && files.includes('pages.yml'));
	const problems = files.flatMap((file) => workflowProblems(file, parse(readFileSync(join(WORKFLOWS, file), 'utf8'))));
	// The workflow users copy is held to the same rules.
	const example = join(WORKFLOWS, '..', '..', 'examples', 'github', 'chartguard.yml');
	problems.push(...workflowProblems('examples/github/chartguard.yml', parse(readFileSync(example, 'utf8'))));
	assert.deepEqual(problems, []);
});

test('the guard catches a writing token, a missing timeout and a job that writes something else', () => {
	const job = { 'runs-on': 'ubuntu-latest', 'timeout-minutes': 5 };
	assert.deepEqual(workflowProblems('w', { permissions: { contents: 'read' }, jobs: { a: job } }), []);
	assert.deepEqual(workflowProblems('w', { jobs: { a: job } }), ['w: top-level permissions must be read-only']);
	assert.deepEqual(workflowProblems('w', { permissions: 'write-all', jobs: {} }), [
		'w: top-level permissions must be read-only'
	]);
	assert.deepEqual(workflowProblems('w', { permissions: { contents: 'write' }, jobs: {} }), [
		'w: top-level permissions must be read-only'
	]);
	assert.deepEqual(workflowProblems('w', { permissions: {}, jobs: { a: { 'runs-on': 'x' } } }), [
		'w: job a has no timeout-minutes'
	]);
	assert.deepEqual(
		workflowProblems('w', {
			permissions: {},
			jobs: { a: { ...job, permissions: { contents: 'write', pages: 'write' } } }
		}),
		['w: job a writes contents']
	);
	assert.deepEqual(workflowProblems('w', { permissions: {}, jobs: { a: { ...job, permissions: 'write-all' } } }), [
		'w: job a sets permissions to write-all'
	]);
});

/** Every `run:` script of a workflow's jobs or a composite action's steps. */
function scriptsOf(document) {
	const steps = [
		...Object.values(document.jobs ?? {}).flatMap((job) => job.steps ?? []),
		...(document.runs?.steps ?? [])
	];
	return steps.flatMap((step) => (typeof step.run === 'string' ? [step.run] : []));
}

/**
 * Template injection (CG-06-08): GitHub pastes an expression's value into a `run:` script before the
 * shell reads it, so an input, a branch name or a pull request title would run as code there. Values
 * reach scripts as environment variables only.
 */
const injectable = (script) => /\$\{\{/u.test(script);

test('no workflow and no action puts an expression into a script: values reach scripts through env', () => {
	const files = [
		...readdirSync(WORKFLOWS)
			.filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
			.map((file) => join(WORKFLOWS, file)),
		join(WORKFLOWS, '..', '..', 'action.yml'),
		join(WORKFLOWS, '..', '..', 'examples', 'github', 'chartguard.yml')
	];
	const found = files.flatMap((file) =>
		scriptsOf(parse(readFileSync(file, 'utf8')))
			.filter(injectable)
			.map((script) => `${file}: ${script.split('\n')[0] ?? ''}`)
	);
	assert.deepEqual(found, []);
	assert.equal(injectable('echo "${{ github.event.pull_request.title }}"'), true);
	assert.equal(injectable('echo "$TITLE"'), false);
	assert.deepEqual(
		scriptsOf({ runs: { steps: [{ run: 'a' }, { uses: 'x' }] }, jobs: { j: { steps: [{ run: 'b' }] } } }),
		['b', 'a']
	);
});

/** Every `npm install --global npm@<version>` step in the parsed workflows. */
function npmPins(workflow) {
	return Object.values(workflow.jobs ?? {}).flatMap((job) =>
		(job.steps ?? []).flatMap(({ run }) =>
			[...String(run ?? '').matchAll(/npm install --global npm@(\S+)/gu)].map((m) => m[1])
		)
	);
}

test('one npm writes and checks the lockfile: the workflows install the version packageManager pins (E73)', () => {
	// A newer npm checks peer dependencies an older one let through: a lockfile written by the older one
	// fails `npm ci` wherever the newer one runs (the GitHub Action runs with the runner's bundled npm).
	const root = fileURLToPath(new URL('../../', import.meta.url));
	const pinned = /^npm@(\d+\.\d+\.\d+)$/u.exec(
		JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
	)?.[1];
	assert.ok(pinned !== undefined, 'packageManager pins an exact npm');
	const pins = readdirSync(WORKFLOWS)
		.filter((file) => /\.ya?ml$/u.test(file))
		.flatMap((file) =>
			npmPins(parse(readFileSync(join(WORKFLOWS, file), 'utf8'))).map((version) => `${file} ${version}`)
		);
	assert.ok(pins.length > 0);
	assert.deepEqual(
		pins.filter((pin) => !pin.endsWith(` ${pinned}`)),
		[]
	);
	assert.ok(readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8').includes(`pins npm ${pinned}`));
});
