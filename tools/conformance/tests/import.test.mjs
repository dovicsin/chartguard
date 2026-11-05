import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { text, verifiedCommit } from '../corpus/import.mjs';

/** The corpus importer's requests: GitHub's limits for unauthenticated calls are shared by every hosted runner. */
const API = 'https://api.github.com/repos/highcharts/highcharts/git/trees/abc?recursive=1';
const RAW = 'https://raw.githubusercontent.com/highcharts/highcharts/abc/license.txt';

/** A fetch that records each request and answers with `status` and `headers`. */
function fake(status = 200, headers = {}) {
	const requests = [];
	const get = (url, init) => {
		requests.push({ url, headers: init?.headers ?? {} });
		return Promise.resolve(new Response(status === 200 ? 'body' : 'denied', { status, headers }));
	};
	return { requests, get };
}

test('with a token, requests to GitHub carry it; without one, none carries a header', async () => {
	const signed = fake();
	for (const url of [API, RAW]) assert.equal(await text(url, { token: 't0k', fetch: signed.get }), 'body');
	assert.deepEqual(
		signed.requests.map(({ headers }) => headers.authorization),
		['Bearer t0k', 'Bearer t0k']
	);
	const anonymous = fake();
	await text(API, { token: undefined, fetch: anonymous.get });
	await text(API, { token: '', fetch: anonymous.get });
	assert.deepEqual(
		anonymous.requests.map(({ headers }) => headers),
		[{}, {}]
	);
});

test('a token is never sent to another host, nor to GitHub over plain http', async () => {
	const other = fake();
	for (const url of [
		'https://example.com/x',
		'https://api.github.com.example.com/x',
		'http://api.github.com/x',
		'https://raw.githubusercontent.com:8443/x'
	])
		await text(url, { token: 't0k', fetch: other.get });
	assert.deepEqual(
		other.requests.map(({ headers }) => headers),
		[{}, {}, {}, {}]
	);
});

test('a rate limit says so and how to lift it; any other failure keeps its status alone', async () => {
	const limited = fake(403, { 'x-ratelimit-remaining': '0' });
	await assert.rejects(
		text(API, { token: undefined, fetch: limited.get }),
		new RegExp(`^Error: ${API.replaceAll(/[?.]/gu, '\\$&')}: HTTP 403: GitHub's rate limit .*set GITHUB_TOKEN`, 'u')
	);
	await assert.rejects(
		text(API, { token: 't0k', fetch: limited.get }),
		/HTTP 403: GitHub's rate limit for this token/u
	);
	await assert.rejects(text(API, { token: undefined, fetch: fake(429).get }), /HTTP 429: GitHub's rate limit/u);
	await assert.rejects(text(API, { token: undefined, fetch: fake(403).get }), /HTTP 403$/u);
	await assert.rejects(text(API, { token: undefined, fetch: fake(404).get }), /HTTP 404$/u);
	// A spent limit on a refusal of another kind is not why it failed.
	await assert.rejects(
		text(API, { token: undefined, fetch: fake(404, { 'x-ratelimit-remaining': '0' }).get }),
		/HTTP 404$/u
	);
});

test('CI imports the Highcharts corpus with the workflow token (E46)', () => {
	const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
	const step = /- run: npm run conformance:import -- highcharts\n((?: {8}.*\n|\s*#.*\n)*)/u.exec(workflow);
	assert.ok(step !== null, 'the import step');
	assert.match(step[1], /^ {8}env:\n(?: {10}#.*\n)* {10}GITHUB_TOKEN: \$\{\{ github\.token \}\}$/mu);
});

test('a tag pin must name its commit; an annotated tag is followed; a branch pin is its commit alone (E98)', async () => {
	const responses = {
		'https://api.github.com/repos/o/r/git/ref/tags/v2.0.0': { object: { type: 'commit', sha: 'new' } },
		'https://api.github.com/repos/o/r/git/ref/tags/v3.0.0': { object: { type: 'tag', sha: 't', url: 'tag-url' } },
		'tag-url': { object: { type: 'commit', sha: 'c3' } }
	};
	const requested = [];
	const read = async (url) => {
		requested.push(url);
		return JSON.stringify(responses[url]);
	};
	assert.equal(await verifiedCommit({ repository: 'o/r', ref: 'v2.0.0', commit: 'new' }, read), 'new');
	await assert.rejects(
		verifiedCommit({ repository: 'o/r', ref: 'v2.0.0', commit: 'old' }, read),
		/v2\.0\.0 is commit new, not the pinned old/u
	);
	assert.equal(await verifiedCommit({ repository: 'o/r', ref: 'v3.0.0', commit: 'c3' }, read), 'c3');
	requested.length = 0;
	assert.equal(await verifiedCommit({ repository: 'o/r', ref: 'gh-pages', commit: 'x' }, read), 'x');
	assert.deepEqual(requested, []);
});
