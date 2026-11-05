import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { referenceUrl } from '@chartguard/core';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';
import { checkText } from '@chartguard/source-checks/text';

import { engineOf, fileNameOf, sourceOf } from '../dist/source.js';
import { collectExamples } from '../scripts/build.mjs';

/**
 * Every finding links to where it is explained (CG-06-07): its code's anchor in the reference (the
 * reference's own test holds each anchor to exist), or a page the adapter names for that finding.
 * Read over every example, as JSON and as source, from each way a finding reaches a reader.
 */
const ADAPTERS = {
	chartjs: { validate: validateChartjs, analyze: analyzeChartjs },
	echarts: { validate: validateEcharts, analyze: analyzeEcharts },
	highcharts: { validate: validateHighcharts, analyze: analyzeHighcharts }
};
const engine = engineOf(ADAPTERS);

/** What is wrong with a finding's link, if anything. */
function linkProblem({ code, documentationUrl }) {
	if (documentationUrl === undefined) return 'no documentationUrl';
	if (documentationUrl === referenceUrl(code)) return undefined;
	return /^https:\/\/echarts\.apache\.org\/en\/option\.html#[\w.-]+$/u.test(documentationUrl)
		? undefined
		: `an unexpected page ${documentationUrl}`;
}

/** Every finding of one example, with where it came from: validated, reviewed (and suppressed), as source. */
function findingsOf(example) {
	const { validate, analyze } = ADAPTERS[example.library];
	const report = analyze(example.config);
	const check = checkText(sourceOf(example), fileNameOf('typescript'), engine);
	return [
		...validate(example.config).diagnostics.map((finding) => ['validate', finding]),
		...report.diagnostics.map((finding) => ['quality', finding]),
		...report.suppressed.map(({ diagnostic }) => ['suppressed', diagnostic]),
		...check.uses.flatMap((use) => use.diagnostics.map((finding) => ['analysis', finding])),
		...check.findings.map((finding) => ['source', finding])
	];
}

test('every finding of every example, validated, reviewed and checked as source, has its link', async () => {
	const problems = [];
	const seen = new Set();
	for (const example of await collectExamples())
		for (const [how, finding] of findingsOf(example)) {
			seen.add(finding.code);
			const problem = linkProblem(finding);
			if (problem !== undefined) problems.push(`${example.id} ${how} ${finding.code} ${finding.path}: ${problem}`);
		}
	assert.deepEqual(problems, []);
	// The examples reach both kinds of code, and an adapter's own page.
	assert.ok([...seen].some((code) => code.startsWith('CFG_')));
	assert.ok([...seen].some((code) => code.startsWith('VIS_')));
	assert.ok(seen.has('CFG_DEPRECATED'));
});

test('a finding without a link, or with a page nobody named, is caught', () => {
	const base = { code: 'CFG_TYPE', path: '$' };
	assert.equal(linkProblem(base), 'no documentationUrl');
	assert.match(linkProblem({ ...base, documentationUrl: 'https://example.com/' }) ?? '', /unexpected page/u);
	assert.equal(linkProblem({ ...base, documentationUrl: referenceUrl('CFG_TYPE') }), undefined);
	assert.match(linkProblem({ ...base, documentationUrl: referenceUrl('CFG_ENUM') }) ?? '', /unexpected page/u);
});
