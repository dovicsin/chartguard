import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { pathSegments } from '@chartguard/core';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';

import { accessorCalls, corpus, deepFreeze, hostileCase, random } from '../lib/hostile.mjs';

/**
 * Hostile configs (CG-07-02): every library's validator and quality review on its own fixtures with a
 * hostile value at a random place. Seeded and bounded by a case count, never by time.
 */
/** Cases per library: a count, never a time; `FUZZ_CASES` raises it for a longer local run. */
const CASES = Number(process.env['FUZZ_CASES'] ?? 400);
const LIBRARIES = {
	chartjs: { validate: validateChartjs, analyze: analyzeChartjs },
	echarts: { validate: validateEcharts, analyze: analyzeEcharts },
	highcharts: { validate: validateHighcharts, analyze: analyzeHighcharts }
};
const SEVERITIES = new Set(['error', 'warning', 'info']);
const CONFIDENCES = new Set(['certain', 'inferred', 'unknown']);

/** What is wrong with one result, or nothing. */
function resultProblems(result, prefix) {
	const problems = [];
	if ('valid' in result && result.valid !== (result.status !== 'invalid')) problems.push('valid disagrees with status');
	for (const { code, severity, confidence, path } of result.diagnostics) {
		if (!new RegExp(`^${prefix}_[A-Z]+(?:_[A-Z]+)*$`, 'u').test(code)) problems.push(`code ${String(code)}`);
		if (!SEVERITIES.has(severity)) problems.push(`severity ${String(severity)}`);
		if (!CONFIDENCES.has(confidence)) problems.push(`confidence ${String(confidence)}`);
		if (pathSegments(path.replace(/\[(\d+)\.\.\d+\]/gu, '[$1]')) === undefined) problems.push(`path ${String(path)}`);
	}
	return problems;
}

/** Runs `check` on the case twice: the invariants every run must keep, as problems. */
function caseProblems(check, config, prefix) {
	const before = Object.keys(Object.prototype).length;
	accessorCalls.count = 0;
	let first;
	let second;
	try {
		first = check(config);
		second = check(config);
	} catch (error) {
		return [`threw ${error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : String(error)}`];
	}
	const problems = resultProblems(first, prefix);
	if (accessorCalls.count > 0) problems.push(`ran ${String(accessorCalls.count)} accessor(s) of the input`);
	if (Object.keys(Object.prototype).length !== before) problems.push('added a key to Object.prototype');
	const text = JSON.stringify(first);
	if (text !== JSON.stringify(second)) problems.push('two runs differ');
	return problems;
}

for (const [library, { validate, analyze }] of Object.entries(LIBRARIES))
	test(`${library}: hostile configs never throw, run a getter, write the input or give a malformed result (seeded)`, async () => {
		const configs = await corpus(library);
		assert.ok(configs.length >= 10, `${library} corpus: ${String(configs.length)}`);
		const failures = [];
		for (let index = 0; index < CASES; index++) {
			const seed = 0x9e3779b1 ^ (index * 2654435761);
			const made = hostileCase(configs, random(seed));
			const config = deepFreeze(made.config);
			for (const [name, check, prefix] of [
				['validate', validate, 'CFG'],
				['analyze', analyze, 'VIS']
			]) {
				const problems = caseProblems(check, config, prefix);
				if (problems.length > 0)
					failures.push(`${name} seed ${String(seed >>> 0)} ${made.kind} at ${made.at}: ${problems.join('; ')}`);
			}
		}
		assert.deepEqual(failures.slice(0, 20), []);
	});

test('the generator is deterministic: a seed makes the same case', async () => {
	const configs = await corpus('chartjs');
	const twice = [1, 2].map(() => {
		const { kind, at } = hostileCase(configs, random(42));
		return `${kind} ${at}`;
	});
	assert.equal(twice[0], twice[1]);
});
