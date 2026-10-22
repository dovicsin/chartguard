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

test('every rule has a trigger, a counterexample and an unknown case, and a case for each of its context conditions', () => {
	for (const { id, context } of RULE_CATALOG) {
		const cases = RULES_CONTRACT.filter((entry) => entry.rule === id);
		for (const kind of ['triggers', 'counterexample', 'unknown'])
			assert.ok(
				cases.some((entry) => entry.kind === kind),
				`${id}: no ${kind} case`
			);
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
