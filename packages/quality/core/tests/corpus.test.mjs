import assert from 'node:assert/strict';
import test from 'node:test';

import { RULE_CATALOG } from '../dist/index.js';
import { RULES_CONTRACT } from './fixtures/rules-contract.mjs';

/**
 * The per-rule fixture corpus (CG-05-05): every contract case names its rule and its kind, and every
 * rule has a chart that triggers it, a counterexample, a chart whose deciding fact is unknown (no
 * claim), and a case for each context condition. tools/conformance renders them all on the pinned
 * runtimes and checks the premises.
 */
const KINDS = ['triggers', 'counterexample', 'unknown', 'context', 'setting'];
const LIBRARIES = ['chartjs', 'echarts', 'highcharts'];
const codeOf = new Map(RULE_CATALOG.map(({ id, code }) => [id, code]));

const libraries = (entry) => LIBRARIES.filter((library) => entry[library] !== undefined);
const claims = (entry, part) =>
	libraries(entry).flatMap((library) => (entry[library][part] ?? []).map((finding) => finding.split(' ')[0]));

test('every case names a rule of the catalog and a kind, and is written for at least one library', () => {
	const names = new Set();
	for (const entry of RULES_CONTRACT) {
		assert.ok(codeOf.has(entry.rule), `${entry.name}: rule ${String(entry.rule)}`);
		assert.ok(KINDS.includes(entry.kind), `${entry.name}: kind ${String(entry.kind)}`);
		assert.ok(libraries(entry).length > 0, entry.name);
		assert.ok(!names.has(entry.name), `${entry.name}: names are unique`);
		names.add(entry.name);
	}
});

/**
 * Where a library cannot express a kind of case for a rule, and why: every other rule, library and
 * kind has a case. An exemption that a case contradicts is stale and fails.
 */
const NO_CASE = [
	{
		rule: 'placeholder-text',
		libraries: ['chartjs', 'echarts'],
		kinds: ['triggers', 'counterexample', 'unknown'],
		why: 'neither draws a text the config does not set: their titles default to empty (Chart.js `text: ""`, ECharts `text: ""`) and they make no axis title of their own'
	},
	{
		rule: 'legend-placeholder',
		libraries: ['echarts'],
		kinds: ['triggers'],
		why: "a legend without `data` lists only the series with a name of their own (`isNameSpecified`), and a name in `legend.data` is the config's own text: echarts never draws an entry the config does not name (its counterexample checks this on the runtime)"
	},
	{
		rule: 'percent-without-unit',
		libraries: ['chartjs', 'echarts'],
		kinds: ['triggers', 'counterexample', 'unknown'],
		why: 'neither stacks as percentages (the rule\'s premise): only Highcharts has `stacking: "percent"`'
	},
	{
		rule: 'keyboard-disabled',
		libraries: ['chartjs', 'echarts'],
		kinds: ['triggers', 'counterexample', 'unknown'],
		why: 'neither has keyboard navigation of its own, so the config never turns it off (A57)'
	},
	{
		rule: 'data-not-described',
		libraries: ['chartjs'],
		kinds: ['triggers', 'counterexample'],
		why: "a canvas's text alternative is the page's: the config never decides it, only a declared context does (its context cases)"
	},
	{
		rule: 'low-contrast-series',
		libraries: ['chartjs'],
		kinds: ['triggers', 'counterexample'],
		why: 'Chart.js paints no background: a series is on the page, compared only when the context declares it (its context cases)'
	}
];
const exempt = (rule, library, kind) =>
	NO_CASE.find((entry) => entry.rule === rule && entry.libraries.includes(library) && entry.kinds.includes(kind));

test('every rule has a trigger, a counterexample and an unknown case for each library, unless that library cannot express it', () => {
	for (const { id } of RULE_CATALOG)
		for (const library of LIBRARIES)
			for (const kind of ['triggers', 'counterexample', 'unknown']) {
				const covered = RULES_CONTRACT.some(
					(entry) => entry.rule === id && entry.kind === kind && entry[library] !== undefined
				);
				const exemption = exempt(id, library, kind);
				assert.ok(covered || exemption !== undefined, `${id}: no ${kind} case for ${library}`);
				assert.ok(!(covered && exemption !== undefined), `${id}: ${library} ${kind} is exempt, but has a case`);
			}
	for (const { rule, why } of NO_CASE) {
		assert.ok(codeOf.has(rule), rule);
		assert.ok(why.length > 0, rule);
	}
});

test('a case for each context condition of every rule', () => {
	for (const { id, context } of RULE_CATALOG) {
		const cases = RULES_CONTRACT.filter((entry) => entry.rule === id);
		for (const { fact, effect } of context) {
			const declared = cases.filter(
				(entry) =>
					entry.kind === 'context' &&
					libraries(entry).some((library) => entry[library].options?.context?.[fact] !== undefined)
			);
			assert.ok(declared.length > 0, `${id}: no case for context.${fact}`);
			// A condition that meets the rule's concern keeps a suppressed finding; one that supplies a fact lets the rule decide.
			const part = effect === 'satisfies' ? 'suppressed' : 'findings';
			assert.ok(
				declared.some((entry) => claims(entry, part).includes(codeOf.get(id))),
				`${id}: context.${fact} ${effect}`
			);
		}
	}
});

test('each kind claims what it says: triggers report the rule, counterexamples and unknowns never do', () => {
	for (const entry of RULES_CONTRACT) {
		const code = codeOf.get(entry.rule);
		const claimed = [...claims(entry, 'findings'), ...claims(entry, 'suppressed')];
		if (entry.kind === 'triggers') assert.ok(claims(entry, 'findings').includes(code), entry.name);
		if (entry.kind === 'counterexample' || entry.kind === 'unknown') assert.ok(!claimed.includes(code), entry.name);
		// Only context and setting cases carry options; the others are the rules as shipped.
		const optioned = libraries(entry).some((library) => entry[library].options !== undefined);
		assert.equal(optioned, entry.kind === 'context' || entry.kind === 'setting', entry.name);
	}
});

test('settings are covered: a rule turned off, a level, and an ignore with its suppressed finding', () => {
	const settings = RULES_CONTRACT.filter((entry) => entry.kind === 'setting').flatMap((entry) =>
		libraries(entry).map((library) => entry[library])
	);
	const rules = settings.flatMap(({ options }) => Object.values(options.rules ?? {}));
	assert.ok(rules.includes('off'));
	assert.ok(rules.some((setting) => setting === 'info' || setting?.level === 'info'));
	assert.ok(
		settings.some(
			({ options, suppressed }) =>
				Object.values(options.rules ?? {}).some((setting) => setting?.ignore !== undefined) && suppressed?.length > 0
		)
	);
});
