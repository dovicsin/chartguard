import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { browserSkipReason } from '../../shared/chrome.mjs';
import { EXPECTATIONS as CHARTJS } from '../corpus/chartjs.expectations.mjs';
import { EXPECTATIONS as ECHARTS } from '../corpus/echarts.expectations.mjs';
import { EXPECTATIONS as HIGHCHARTS } from '../corpus/highcharts.expectations.mjs';
import { allowedExplanations, corpusFile, isClean, isQuiet } from '../lib/corpus.mjs';
import { runHighchartsCorpus } from '../lib/highcharts-corpus.mjs';
import { runCorpus } from '../lib/sandbox.mjs';

const NO_PERMISSION_MODEL = 'this Node version has no permission model to isolate upstream code';

/** Why a local corpus (Highcharts) cannot run here: not imported yet (a failure on CI), or no browser. */
function localSkipReason(library) {
	if (existsSync(corpusFile(library))) return browserSkipReason();
	if (process.env['CI'] !== undefined) throw new Error(`CI must import the ${library} corpus first`);
	return `import it first: node tools/conformance/corpus/import.mjs ${library}`;
}

const CORPORA = [
	{
		library: 'chartjs',
		expectations: CHARTJS,
		prefix: 'docs/samples/',
		license: /The MIT License/,
		minimumQuiet: 60,
		run: (path) => runCorpus('chartjs', path) ?? NO_PERMISSION_MODEL
	},
	{
		library: 'echarts',
		expectations: ECHARTS,
		prefix: 'public/examples/ts/',
		license: /Apache License\s+Version 2\.0/,
		minimumQuiet: 170,
		run: (path) => runCorpus('echarts', path) ?? NO_PERMISSION_MODEL
	},
	{
		library: 'highcharts',
		expectations: HIGHCHARTS,
		prefix: 'samples/highcharts/demo/',
		license: /shop\.highcharts\.com/,
		minimumQuiet: 90,
		run: (path) => localSkipReason('highcharts') ?? runHighchartsCorpus(path)
	}
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

for (const { library, expectations, prefix, license, minimumQuiet, run } of CORPORA) {
	const file = corpusFile(library);
	const ran = existsSync(file) ? await run(file) : localSkipReason(library);
	const outcomes = typeof ran === 'string' ? undefined : ran;
	const skip = typeof ran === 'string' ? ran : false;
	const corpus = outcomes === undefined && !existsSync(file) ? undefined : JSON.parse(readFileSync(file, 'utf8'));
	const listed = new Map(expectations.flatMap(({ why, paths }) => paths.map((path) => [`${prefix}${path}`, why])));

	test(`${library} corpus is pinned and licensed`, { skip: corpus === undefined ? skip : false }, () => {
		assert.match(corpus.source.commit, /^[0-9a-f]{40}$/);
		assert.match(corpus.source.licenseText, license);
		for (const example of corpus.files) {
			assert.ok(example.path.startsWith(prefix), example.path);
			assert.match(example.sha256, /^[0-9a-f]{64}$/);
			// A local corpus is never reviewed in git: its content must still be what the pin hashed.
			if (example.page !== undefined)
				assert.deepEqual([sha256(example.code), sha256(example.page)], [example.sha256, example.pageSha256], example.path);
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
			// Clean, or validator and runtime agree (an error the runtime also signals): nothing to explain.
			const agrees = isClean(outcome) || (outcome.status === 'ran' && allowed.length === 0);
			if (agrees ? why !== undefined : !allowed.some((start) => why?.startsWith(start) === true))
				unexplained.push({ path: outcome.path, why, allowed, outcome });
		}
		assert.deepEqual(unexplained, []);
		const known = new Set(outcomes.map(({ path }) => path));
		assert.deepEqual([...listed.keys()].filter((path) => !known.has(path)), []);
		// The floor counts quiet examples: an explained, certain deprecation is not noise.
		assert.ok(outcomes.filter(isQuiet).length >= minimumQuiet);
	});
}
