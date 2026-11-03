import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

/** E46: every workflow runs with least privilege and bounded, read on the syntax tree of its YAML. */
const WORKFLOWS = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));

/** The write scopes a job may ask for, by what it does: deploying Pages (CG-06-06 part 4). */
const JOB_WRITES = new Set(['pages', 'id-token']);

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
