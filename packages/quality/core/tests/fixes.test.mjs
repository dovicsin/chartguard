import assert from 'node:assert/strict';
import test from 'node:test';

import { currentAt, RULE_CATALOG, withFixes } from '../dist/index.js';

/** Verified fixes (CG-05-06): a remedy's edit is offered only when the config with it no longer has the finding nor a new one. */
const finding = (code, path, ruleId = 'r') => ({
	code,
	path,
	ruleId,
	severity: 'warning',
	message: 'm',
	confidence: 'inferred'
});
const report = (diagnostics, suppressed = []) => ({
	library: 't',
	rulesVersion: 'v',
	diagnostics,
	suppressed,
	disabled: []
});

/** A toy analysis: X at $.y.min while it is above zero, Z at $.z while it is true. */
const analyze = (config) =>
	report([
		...(config?.y?.min > 0 ? [finding('X', '$.y.min')] : []),
		...(config?.z === true ? [finding('Z', '$.z', 'other')] : [])
	]);
const toZero = { r: (now) => (now.set && typeof now.value === 'number' ? { value: 0, effect: 'zero' } : undefined) };

test('currentAt: a plain value, nothing, or undefined when the option is not a plain value', () => {
	const config = { y: { min: 5, label: null, f: () => 1, o: {} }, g: Object.defineProperty({}, 'v', { get: () => 1 }) };
	assert.deepEqual(currentAt(config, '$.y.min'), { set: true, value: 5 });
	assert.deepEqual(currentAt(config, '$.y.label'), { set: true, value: null });
	assert.deepEqual(currentAt(config, '$.y.max'), { set: false });
	assert.deepEqual(currentAt(config, '$.x.max'), { set: false });
	assert.equal(currentAt(config, '$.y.f'), undefined);
	assert.equal(currentAt(config, '$.y.o'), undefined);
	assert.equal(currentAt(config, '$.g.v'), undefined);
	assert.equal(currentAt({ y: 5 }, '$.y.min'), undefined);
	assert.equal(currentAt(config, '$'), undefined);
	assert.equal(currentAt(config, 'y.min'), undefined);
});

test('a remedy is offered as a set-option edit, with what the option held, once the analysis confirms it', () => {
	const config = { y: { min: 50 } };
	const [fixed] = withFixes(analyze(config), config, toZero, analyze).diagnostics;
	assert.deepEqual(fixed.fix, { kind: 'set-option', path: '$.y.min', from: 50, value: 0, effect: 'zero' });
	// Nothing held there: no `from`.
	const unset = { r: () => ({ value: 1, effect: 'set' }) };
	const empty = report([finding('X', '$.y.max')]);
	const fixes = withFixes(empty, {}, unset, () => report([])).diagnostics[0].fix;
	assert.deepEqual(fixes, { kind: 'set-option', path: '$.y.max', value: 1, effect: 'set' });
	assert.equal(Object.hasOwn(fixes, 'from'), false);
});

test('no fix when the remedy declines, the option is not a plain value, the edit does not apply, or the analysis disagrees', () => {
	const none = (config, remedies, check = analyze, base = analyze(config)) =>
		withFixes(base, config, remedies, check).diagnostics.map(({ fix }) => fix);
	assert.deepEqual(none({ y: { min: 50 } }, {}), [undefined]);
	assert.deepEqual(none({ y: { min: 50 } }, { r: () => undefined }), [undefined]);
	assert.deepEqual(none({ y: { min: '50' } }, toZero, analyze, report([finding('X', '$.y.min')])), [undefined]);
	const hidden = { y: Object.defineProperty({}, 'min', { get: () => 50, enumerable: true }) };
	assert.deepEqual(none(hidden, toZero, analyze, report([finding('X', '$.y.min')])), [undefined]);
	// The finding stays: the edit does not resolve it.
	assert.deepEqual(none({ y: { min: 50 } }, { r: () => ({ value: 10, effect: 'e' }) }), [undefined]);
	// A new finding appears: the edit brings another problem.
	const bringsZ = { r: () => ({ value: 0, effect: 'e' }) };
	assert.deepEqual(
		none({ y: { min: 50 } }, bringsZ, (config) =>
			report([...analyze(config).diagnostics, finding('Z', '$.z', 'other')])
		),
		[undefined]
	);
	// A path that cannot be edited (through an array without that element): no fix, no error.
	assert.deepEqual(
		none({ s: [] }, { r: () => ({ value: 0, effect: 'e' }) }, () => report([]), report([finding('X', '$.s[0].min')])),
		[undefined]
	);
	// Any other failure of the analysis is a defect, not a declined fix.
	assert.throws(
		() =>
			withFixes(analyze({ y: { min: 5 } }), { y: { min: 5 } }, toZero, () => {
				throw new RangeError('boom');
			}),
		RangeError
	);
});

test('findings already there may stay; suppressed findings get their fix too; a finding of another rule is untouched', () => {
	const config = { y: { min: 50 }, z: true };
	const before = analyze(config);
	const after = withFixes(before, config, toZero, analyze);
	assert.deepEqual(
		after.diagnostics.map(({ code, fix }) => [code, fix?.value]),
		[
			['X', 0],
			['Z', undefined]
		]
	);
	const held = report([], [{ diagnostic: finding('X', '$.y.min'), by: 'setting', reason: 'r' }]);
	const kept = withFixes(held, { y: { min: 50 } }, toZero, (input) =>
		report(
			[],
			analyze(input).diagnostics.map((diagnostic) => ({ diagnostic, by: 'setting', reason: 'r' }))
		)
	);
	assert.equal(kept.suppressed[0].diagnostic.fix.value, 0);
	assert.equal(kept.suppressed[0].reason, 'r');
});

test('every rule says whether it offers a fix: the edit, or why there is none', () => {
	for (const { id, fix } of RULE_CATALOG) {
		assert.equal(typeof fix.offered, 'boolean', id);
		const text = fix.offered ? fix.edit : fix.why;
		assert.ok(typeof text === 'string' && text.length > 20, id);
	}
	assert.deepEqual(
		RULE_CATALOG.filter(({ fix }) => fix.offered).map(({ id }) => id),
		[
			'bar-baseline',
			'bar-log-scale',
			'reversed-value-axis',
			'percent-without-unit',
			'data-not-described',
			'keyboard-disabled',
			'long-motion'
		]
	);
});
