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
 * SARIF to code scanning (the users' workflow, CG-06-08), an OIDC token to publish (the release).
 */
const JOB_WRITES = new Set(['pages', 'id-token', 'security-events']);

/** Whether a permissions block only reads: an object of `read`/`none` scopes. */
const readsOnly = (permissions) =>
	permissions !== null &&
	typeof permissions === 'object' &&
	Object.values(permissions).every((scope) => scope === 'read' || scope === 'none');

/**
 * Whether a job's bound is its own: a job that calls a workflow of this directory cannot take a
 * timeout (GitHub refuses one there); the called workflow's jobs are checked as every file here is.
 */
const calledHere = (job) => typeof job.uses === 'string' && /^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(job.uses);

/** One job's problems: no timeout, a workflow called from elsewhere, a blanket permission, a write scope it does not need. */
function jobProblems(name, id, job) {
	const problems =
		typeof job['timeout-minutes'] === 'number' || calledHere(job) ? [] : [`${name}: job ${id} has no timeout-minutes`];
	if (typeof job.uses === 'string' && !calledHere(job)) problems.push(`${name}: job ${id} calls ${job.uses}`);
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
	// A job calling a workflow of this directory is bounded by that workflow's jobs; any other is not ours.
	assert.deepEqual(
		workflowProblems('w', { permissions: {}, jobs: { a: { uses: './.github/workflows/pages.yml' } } }),
		[]
	);
	assert.deepEqual(
		workflowProblems('w', { permissions: {}, jobs: { a: { uses: 'someone/else/.github/workflows/x.yml@v1' } } }),
		['w: job a has no timeout-minutes', 'w: job a calls someone/else/.github/workflows/x.yml@v1']
	);
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

/** The Node version a workflow's `actions/setup-node` step of `job` runs on. */
const setupNode = (job) =>
	job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'))?.with?.['node-version'];

test('CI runs the lowest Node the packages support on every platform, and one target Node everywhere (CG-07-05)', () => {
	const read = (path) => readFileSync(join(WORKFLOWS, '..', '..', path), 'utf8');
	const ci = parse(read('.github/workflows/ci.yml'));
	const floor = /^>=(\d+)\.\d+\.\d+$/u.exec(JSON.parse(read('package.json')).engines.node);
	assert.ok(floor, 'engines.node is a lowest version, >=x.y.z');
	const { os, node } = ci.jobs.consumers.strategy.matrix;
	assert.deepEqual([...os].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest']);
	assert.ok(node.includes(floor[0].slice(2)), `consumers run on ${floor[0].slice(2)}`);
	// The full check covers each supported line from the lowest; its newest is the target everywhere else.
	const lines = ci.jobs.check.strategy.matrix.node;
	assert.equal(Math.min(...lines), Number(floor[1]));
	const target = Math.max(...lines);
	assert.ok(node.includes(target));
	assert.equal(setupNode(ci.jobs.trend), target);
	assert.equal(setupNode(parse(read('.github/workflows/pages.yml')).jobs.build), target);
	assert.equal(parse(read('action.yml')).inputs['node-version'].default, String(target));
});

test('every platform and Node the consumers job covers regenerates the committed schemas from LF checkouts (CG-07-06)', () => {
	const root = join(WORKFLOWS, '..', '..');
	const { steps } = parse(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8')).jobs.consumers;
	const runs = steps.map((step) => step.run);
	assert.ok(runs.indexOf('npm run schema:check') > runs.indexOf('npm run build'), 'schema:check after the build');
	// Windows runners check text out with CRLF unless the repository says otherwise.
	const attributes = readFileSync(join(root, '.gitattributes'), 'utf8')
		.split('\n')
		.filter((line) => line.trim() !== '' && !line.startsWith('#'));
	assert.deepEqual(attributes, ['* text=auto eol=lf']);
});

/** The CLI sources the action steps of a job use: `checkout` (built from the action's checkout) or `published`. */
const cliSources = (job) =>
	new Set(
		(job.steps ?? [])
			.filter((step) => step.uses === './')
			.map((step) => (String(step.with?.['chartguard-version'] ?? '') === '' ? 'checkout' : 'published'))
	);

test('CI runs the action both ways a user can: built from its checkout and with the published CLI (CG-06-08)', () => {
	const ci = parse(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8'));
	assert.deepEqual([...cliSources(ci.jobs.action)].sort(), ['checkout', 'published']);
	assert.deepEqual([...cliSources({ steps: [{ uses: './', with: { library: 'chartjs' } }] })], ['checkout']);
	assert.deepEqual(
		[...cliSources({ steps: [{ uses: './', with: { 'chartguard-version': 'latest' } }] })],
		['published']
	);
});
