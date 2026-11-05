import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

/**
 * E91: what the release must hold. It starts only by hand on main, publishes only a commit CI passed
 * and only after the site is deployed, in the `release` environment (the maintainer approves), with
 * this run's OIDC token: no stored credential besides the npm fallback, no persisted git credential,
 * no dependency cache and no lifecycle script in the job that can publish, the extension a pre-release.
 */
const WORKFLOWS = fileURLToPath(new URL('../../.github/workflows/', import.meta.url));
const read = (file) => parse(readFileSync(join(WORKFLOWS, file), 'utf8'));

const publishSteps = (release) => release.jobs?.publish?.steps ?? [];
const publishRuns = (release) => publishSteps(release).map(({ run }) => String(run ?? ''));
const usesAction = (prefix) => (step) => String(step.uses ?? '').startsWith(prefix);
const installs = (run) => /\bnpm (?:ci|install)\b(?! --global npm@)/u.test(run);

/** Each property of the release, with the problem its absence is. */
const PROPERTIES = [
	['starts only by hand', (release) => Object.keys(release.on ?? {}).join() === 'workflow_dispatch'],
	['runs only on main', (release) => String(release.jobs?.verify?.if).includes("github.ref == 'refs/heads/main'")],
	[
		'checks the commit passed CI',
		(release) =>
			(release.jobs?.verify?.steps ?? []).some(({ run }) =>
				String(run).includes('actions/workflows/ci.yml/runs?head_sha=$SHA')
			)
	],
	[
		'deploys the site after verify',
		(release) => release.jobs?.pages?.uses === './.github/workflows/pages.yml' && release.jobs.pages.needs === 'verify'
	],
	['pages.yml can be called', (_, pages) => Object.hasOwn(pages.on ?? {}, 'workflow_call')],
	[
		'publishes after verify and the site',
		(release) => ['verify', 'pages'].every((job) => (release.jobs?.publish?.needs ?? []).includes(job))
	],
	['publishes in the release environment', (release) => release.jobs?.publish?.environment?.name === 'release'],
	[
		'one job holds the release environment',
		(release) => Object.values(release.jobs ?? {}).filter((job) => job.environment !== undefined).length === 1
	],
	[
		'checks out without persisting credentials',
		(release) =>
			publishSteps(release).some(
				(step) => usesAction('actions/checkout@')(step) && step.with?.['persist-credentials'] === false
			)
	],
	[
		'uses no dependency cache',
		(release) =>
			publishSteps(release).every(
				(step) =>
					!usesAction('actions/cache')(step) &&
					(!usesAction('actions/setup-node@')(step) || step.with?.cache === undefined)
			)
	],
	[
		'installs without lifecycle scripts',
		(release) =>
			publishRuns(release).some(installs) &&
			publishRuns(release).every((run) => !installs(run) || run.includes('--ignore-scripts'))
	],
	[
		'publishes the extension with OIDC',
		(release) => publishRuns(release).some((run) => run.includes('vsce publish') && run.includes('--oidc'))
	],
	[
		'packages the extension as a pre-release',
		(release) => publishRuns(release).some((run) => run.includes('vsce package') && run.includes('--pre-release'))
	],
	[
		'uses no stored credential but NPM_TOKEN',
		(release) => (JSON.stringify(release).match(/secrets\.\w+/gu) ?? []).every((name) => name === 'secrets.NPM_TOKEN')
	]
];

const releaseProblems = (release, pages) =>
	PROPERTIES.filter(([, holds]) => !holds(release, pages)).map(([problem]) => problem);

const RELEASE = read('release.yml');
const PAGES = read('pages.yml');

/** The release with one change, made on a copy. */
function changed(change) {
	const copy = structuredClone(RELEASE);
	change(copy);
	return copy;
}

/** The publish step whose script starts with `prefix`, in `release`. */
const stepOf = (release, prefix) => publishSteps(release).find(({ run }) => String(run ?? '').startsWith(prefix));

/** Each property broken alone, with what the guard must say. */
const BROKEN = [
	[(copy) => Object.assign(copy, { on: { workflow_dispatch: null, push: null } }), ['starts only by hand']],
	[(copy) => Object.assign(copy.jobs.verify, { if: undefined }), ['runs only on main']],
	[(copy) => Object.assign(copy.jobs.verify, { steps: [] }), ['checks the commit passed CI']],
	[(copy) => Object.assign(copy.jobs.pages, { needs: undefined }), ['deploys the site after verify']],
	[(copy) => Object.assign(copy.jobs.publish, { needs: ['verify'] }), ['publishes after verify and the site']],
	[
		(copy) => Object.assign(copy.jobs.publish, { environment: undefined }),
		['publishes in the release environment', 'one job holds the release environment']
	],
	[(copy) => Object.assign(publishSteps(copy)[0], { with: {} }), ['checks out without persisting credentials']],
	[(copy) => Object.assign(publishSteps(copy)[1].with, { cache: 'npm' }), ['uses no dependency cache']],
	[(copy) => Object.assign(stepOf(copy, 'npm ci'), { run: 'npm ci' }), ['installs without lifecycle scripts']],
	[
		(copy) => Object.assign(stepOf(copy, 'npx vsce publish'), { run: 'npx vsce publish --packagePath x.vsix' }),
		['publishes the extension with OIDC']
	],
	[
		(copy) => Object.assign(stepOf(copy, 'npx vsce package'), { run: 'npx vsce package --out x.vsix' }),
		['packages the extension as a pre-release']
	],
	[
		(copy) => Object.assign(stepOf(copy, 'npx vsce publish'), { env: { VSCE_PAT: '${{ secrets.VSCE_PAT }}' } }),
		['uses no stored credential but NPM_TOKEN']
	]
];

test('the release publishes by hand from main, after CI and the site, approved, with OIDC (E91)', () => {
	assert.deepEqual(releaseProblems(RELEASE, PAGES), []);
});

test('the release guard catches each property broken alone', () => {
	for (const [change, expected] of BROKEN) assert.deepEqual(releaseProblems(changed(change), PAGES), expected);
	assert.deepEqual(releaseProblems(RELEASE, { on: { workflow_dispatch: null } }), ['pages.yml can be called']);
});
