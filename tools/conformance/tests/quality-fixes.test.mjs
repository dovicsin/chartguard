import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { validate as validateChartjs } from '../../../packages/config/chartjs/dist/index.js';
import { validate as validateEcharts } from '../../../packages/config/echarts/dist/index.js';
import { validate as validateHighcharts } from '../../../packages/config/highcharts/dist/index.js';
import { applyFix, isConfirmedError } from '../../../packages/core/dist/index.js';
import { analyze as analyzeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULE_CATALOG } from '../../../packages/quality/core/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { analyze as analyzeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { analyze as analyzeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { runEchartsInBrowser } from '../lib/echarts-browser.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';
import { builtChartjs, builtEcharts, builtHighcharts, PREMISES } from '../lib/quality-built.mjs';

/**
 * The quality fixes against the runtimes (CG-05-06). A fix is trustworthy when, applied:
 * - the config still renders on the pinned runtime, and the config validator finds no new confirmed error;
 * - the adapter no longer reports the finding, nor any finding it did not report before;
 * - the runtime no longer draws what the rule is about (the premise), where it was the only cause.
 * Every fix on every contract case is checked, and every before/after example in examples/quality-fixes.
 */
const LIBRARIES = {
	chartjs: { analyze: analyzeChartjs, validate: validateChartjs, render: runChartjs },
	echarts: { analyze: analyzeEcharts, validate: validateEcharts, render: runEcharts },
	highcharts: { analyze: analyzeHighcharts, validate: validateHighcharts }
};
const CODE_OF = new Map(RULE_CATALOG.map(({ id, code }) => [id, code]));
const OFFERED = new Set(RULE_CATALOG.filter(({ fix }) => fix.offered).map(({ code }) => code));
const EXAMPLES_DIR = new URL('../../../examples/quality-fixes/', import.meta.url);
const EXAMPLES = readdirSync(EXAMPLES_DIR)
	.filter((name) => name.endsWith('.json'))
	.sort()
	.map((name) => ({ name, ...JSON.parse(readFileSync(new URL(name, EXAMPLES_DIR), 'utf8')) }));

const keyOf = ({ code, path }) => `${code} ${path}`;
const everything = (report) => [...report.diagnostics, ...report.suppressed.map(({ diagnostic }) => diagnostic)];
/** The same edit, whatever finding offered it (one edit can resolve several findings). */
const editKey = ({ path, from, value }) => JSON.stringify([path, from, value]);
const confirmed = (result) => new Set(result.diagnostics.filter(isConfirmedError).map(keyOf));

/** Every distinct fix the adapter offers on a config, with the findings it resolves. */
function fixesOf(report) {
	const edits = new Map();
	for (const finding of everything(report))
		if (finding.fix !== undefined)
			edits.set(editKey(finding.fix), {
				fix: finding.fix,
				resolves: [...(edits.get(editKey(finding.fix))?.resolves ?? []), finding]
			});
	return [...edits.values()];
}

/** The adapter's side of a fix: resolved, nothing new, the input untouched, no new confirmed config error. */
function checkFix({ library, config, options }, { fix, resolves }, where) {
	const { analyze, validate } = LIBRARIES[library];
	const before = analyze(config, options);
	const snapshot = copyPlain(config);
	const after = applyFix(config, fix);
	assert.deepEqual(config, snapshot, `${where}: the input is never written`);
	const left = new Set(everything(analyze(after, options)).map(keyOf));
	for (const finding of resolves) assert.ok(!left.has(keyOf(finding)), `${where}: ${keyOf(finding)} still reported`);
	const earlier = new Set(everything(before).map(keyOf));
	for (const key of left) assert.ok(earlier.has(key), `${where}: the fix brings ${key}`);
	const [was, is] = [confirmed(validate(config)), confirmed(validate(after))];
	for (const key of is) assert.ok(was.has(key), `${where}: the fix makes the config invalid: ${key}`);
	return after;
}

/** The fixed rules whose premise the runtime must no longer show: those the fix removes every finding of. */
function cleared(report, resolves) {
	const codes = new Set(resolves.map(({ code }) => code));
	return [...codes].filter(
		(code) =>
			everything(report).filter((finding) => finding.code === code).length ===
			resolves.filter((finding) => finding.code === code).length
	);
}

/** Before a fix the premise of each cleared rule holds; after it, it does not (it must be measured both times). */
function checkPremises(codes, before, after, where) {
	for (const code of codes) {
		assert.equal(PREMISES[code](before), true, `${where}: ${code} before`);
		assert.equal(PREMISES[code](after), false, `${where}: ${code} after`);
	}
}

const isJson = (value) => isDeepStrictEqual(JSON.parse(JSON.stringify(value)), copyPlain(value));
const browser = { skip: browserSkipReason() ?? false };

/** The contract cases and the fixes their findings carry, per library. */
const CASES = RULES_CONTRACT.flatMap((entry) =>
	Object.keys(LIBRARIES).flatMap((library) => {
		if (entry[library] === undefined) return [];
		const { config, options } = entry[library];
		const report = LIBRARIES[library].analyze(config, options);
		return fixesOf(report).map((fixed) => ({ entry, library, config, options, report, ...fixed }));
	})
);

/** Every finding the adapters report or suppress on the contract cases. */
const FINDINGS = RULES_CONTRACT.flatMap((entry) =>
	Object.keys(LIBRARIES).flatMap((key) =>
		entry[key] === undefined
			? []
			: everything(LIBRARIES[key].analyze(entry[key].config, entry[key].options)).map((finding) => ({ entry, finding }))
	)
);

test('a fix is offered only for a rule whose catalog entry offers one, and every such rule has one on the corpus', () => {
	const offered = new Set();
	for (const { entry, finding } of FINDINGS.filter((item) => item.finding.fix !== undefined)) {
		assert.ok(OFFERED.has(finding.code), `${entry.name}: ${finding.code} offers no fix`);
		assert.deepEqual([finding.fix.kind, finding.fix.path], ['set-option', finding.path]);
		offered.add(finding.code);
	}
	assert.deepEqual(
		[...OFFERED].filter((code) => !offered.has(code)),
		[]
	);
});

for (const { entry, library, config, options, report, fix, resolves } of CASES.filter(
	(item) => item.library !== 'highcharts'
))
	test(`quality fixes, ${library}: ${entry.name}: ${fix.path} = ${JSON.stringify(fix.value)}`, () => {
		const where = `${entry.name} ${fix.path}`;
		const after = checkFix({ library, config, options }, { fix, resolves }, where);
		assert.equal(verdictOf(LIBRARIES[library].render(copyPlain(after))), 'accepted', where);
		// echarts' description needs a DOM; it is measured for the examples, in Chrome.
		const codes = cleared(report, resolves).filter(
			(code) => !(library === 'echarts' && code === 'VIS_DATA_NOT_DESCRIBED')
		);
		const built = library === 'chartjs' ? builtChartjs : builtEcharts;
		const args = (input) => (library === 'chartjs' ? [input, options] : [input, undefined, options]);
		checkPremises(codes, built(...args(config)), built(...args(after)), where);
	});

test(
	'quality fixes, highcharts: every fix on the corpus renders, resolves its findings and clears its premise',
	browser,
	async () => {
		const cases = CASES.filter(({ library }) => library === 'highcharts').map((item) => ({
			...item,
			after: checkFix(item, item, `${item.entry.name} ${item.fix.path}`)
		}));
		const outcomes = await runHighcharts(cases.flatMap(({ config, after }) => [{ config }, { config: after }]));
		cases.forEach(({ entry, fix, report, resolves, config, after, options }, index) => {
			const [before, fixed] = [outcomes[2 * index], outcomes[2 * index + 1]];
			const where = `${entry.name} ${fix.path}`;
			assert.equal(verdictOf(fixed), 'accepted', `${where}: ${JSON.stringify(fixed.messages)}`);
			checkPremises(
				cleared(report, resolves),
				builtHighcharts(before.observed, config, options),
				builtHighcharts(fixed.observed, after, options),
				where
			);
		});
	}
);

test('the before/after examples: one per fixable rule and library that can express it, each exactly what the adapter reports and applies', () => {
	const expressible = {
		'data-not-described': ['echarts', 'highcharts'],
		'keyboard-disabled': ['highcharts'],
		'percent-without-unit': ['highcharts']
	};
	for (const { id, fix } of RULE_CATALOG) {
		const libraries = fix.offered ? (expressible[id] ?? Object.keys(LIBRARIES)) : [];
		assert.deepEqual(
			EXAMPLES.filter(({ rule }) => rule === id)
				.map(({ library }) => library)
				.sort(),
			[...libraries].sort(),
			id
		);
	}
	for (const { name, rule, library, before, findings, after } of EXAMPLES) {
		assert.equal(name, `${rule}.${library}.json`);
		const report = LIBRARIES[library].analyze(before);
		assert.deepEqual(
			report.diagnostics.map(({ code, path, fix }) => ({ code, path, fix })),
			findings,
			name
		);
		assert.ok(
			findings.some(({ code }) => code === CODE_OF.get(rule)),
			name
		);
		const edits = fixesOf(report);
		assert.equal(edits.length, 1, `${name}: one edit`);
		assert.deepEqual(checkFix({ library, config: before }, edits[0], name), after, name);
		assert.deepEqual(LIBRARIES[library].analyze(after).diagnostics, [], `${name}: nothing left`);
	}
});

test('the examples on the runtimes: before draws what the rule is about, after does not', browser, async () => {
	for (const { name, library, before, after, findings } of EXAMPLES.filter(
		(example) => example.library !== 'highcharts'
	)) {
		for (const config of [before, after])
			assert.equal(verdictOf(LIBRARIES[library].render(copyPlain(config))), 'accepted', name);
		const codes = [...new Set(findings.map(({ code }) => code))];
		if (library === 'chartjs') checkPremises(codes, builtChartjs(before), builtChartjs(after), name);
		else {
			assert.ok(isJson(before) && isJson(after), name);
			const [described, fixed] = await runEchartsInBrowser([copyPlain(before), copyPlain(after)]);
			checkPremises(codes, builtEcharts(before, described), builtEcharts(after, fixed), name);
		}
	}
	const highcharts = EXAMPLES.filter((example) => example.library === 'highcharts');
	const outcomes = await runHighcharts(
		highcharts.flatMap(({ before, after }) => [{ config: before }, { config: after }])
	);
	highcharts.forEach(({ name, before, after, findings }, index) => {
		const [drawn, fixed] = [outcomes[2 * index], outcomes[2 * index + 1]];
		for (const outcome of [drawn, fixed])
			assert.equal(verdictOf(outcome), 'accepted', `${name}: ${JSON.stringify(outcome.messages)}`);
		const codes = [...new Set(findings.map(({ code }) => code))];
		checkPremises(codes, builtHighcharts(drawn.observed, before), builtHighcharts(fixed.observed, after), name);
	});
});
