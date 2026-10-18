import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { EXPECTATIONS as CHARTJS } from '../corpus/chartjs.expectations.mjs';
import { EXPECTATIONS as ECHARTS } from '../corpus/echarts.expectations.mjs';
import { allowedExplanations, isClean } from '../lib/corpus.mjs';
import { runCorpus } from '../lib/sandbox.mjs';

const CORPORA = [
	{ library: 'chartjs', expectations: CHARTJS, prefix: 'docs/samples/', minimumClean: 60 },
	{ library: 'echarts', expectations: ECHARTS, prefix: 'public/examples/ts/', minimumClean: 170 }
];

const corpusPath = (library) => fileURLToPath(new URL(`../corpus/${library}.json`, import.meta.url));

for (const { library, expectations, prefix, minimumClean } of CORPORA) {
	const corpus = JSON.parse(readFileSync(corpusPath(library), 'utf8'));
	const outcomes = runCorpus(library, corpusPath(library));
	const skip = outcomes === undefined ? 'this Node version has no permission model to isolate upstream code' : false;
	const listed = new Map(expectations.flatMap(({ why, paths }) => paths.map((path) => [`${prefix}${path}`, why])));

	test(`${library} corpus is pinned and licensed`, () => {
		assert.match(corpus.source.commit, /^[0-9a-f]{40}$/);
		assert.ok(corpus.source.licenseText.length > 500);
		for (const { path, sha256 } of corpus.files) {
			assert.ok(path.startsWith(prefix), path);
			assert.match(sha256, /^[0-9a-f]{64}$/);
		}
	});

	test(`${library} official examples: no confirmed error on anything the runtime renders`, { skip }, () => {
		const rejected = outcomes.filter(
			(outcome) =>
				outcome.status === 'ran' &&
				outcome.runtime !== 'rejected' &&
				outcome.findings.some((finding) => finding.startsWith('error ')) &&
				!listed.get(outcome.path)?.startsWith('Type contract:')
		);
		assert.deepEqual(rejected, []);
	});

	test(`${library} official examples: every non-clean outcome is explained, and only those`, { skip }, () => {
		const unexplained = [];
		for (const outcome of outcomes) {
			const why = listed.get(outcome.path);
			const allowed = allowedExplanations(outcome);
			if (isClean(outcome) ? why !== undefined : !allowed.some((start) => why?.startsWith(start) === true))
				unexplained.push({ path: outcome.path, why, allowed, outcome });
		}
		assert.deepEqual(unexplained, []);
		const known = new Set(outcomes.map(({ path }) => path));
		assert.deepEqual([...listed.keys()].filter((path) => !known.has(path)), []);
		assert.ok(outcomes.filter(isClean).length >= minimumClean);
	});
}
