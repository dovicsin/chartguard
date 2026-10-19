import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { itemsOf, readOwn, s, validateConfig } from '../dist/index.js';

const manifest = {
	library: 'test',
	version: '1.0.0',
	coverage: 'partial',
	source: 'test',
	root: s.object({}, { additional: 'allow' })
};
const findings = (result) => result.diagnostics.map((d) => `${d.severity} ${d.confidence} ${d.code} ${d.path}`);

/** A rule that rejects a `heat` without `scale`, and warns about a `legend` naming a missing `series`. */
const RULES = [
	{
		id: 'test/heat-needs-scale',
		check: (input, context) => {
			const heat = readOwn(input, 'heat');
			const scale = readOwn(input, 'scale');
			if (!heat.known || !scale.known || heat.value === undefined || scale.value !== undefined) return [];
			return [context.rejected('CFG_REQUIRES', '$.heat', 'A heat needs a scale; the runtime throws.')];
		}
	},
	{
		id: 'test/legend-names',
		check: (input, context) => {
			const legend = readOwn(input, 'legend');
			const name = readOwn(input, 'name');
			if (!legend.known || !name.known || legend.value === undefined || legend.value === name.value) return [];
			return [
				context.warned('CFG_UNKNOWN_REFERENCE', '$.legend', 'Names no series.', `Did you mean "${String(name.value)}"?`)
			];
		}
	}
];

test('rule findings follow the schema findings, and only the core derives valid and status from them', () => {
	const result = validateConfig({ heat: 1, legend: 'b', name: 'a' }, manifest, {}, RULES);
	assert.deepEqual(findings(result), [
		'error certain CFG_REQUIRES $.heat',
		'warning certain CFG_UNKNOWN_REFERENCE $.legend'
	]);
	assert.equal(result.diagnostics[1].suggestion, 'Did you mean "a"?');
	assert.equal(result.valid, false);
	assert.deepEqual(findings(validateConfig({ heat: 1, scale: 2 }, manifest, {}, RULES)), []);
	assert.deepEqual(findings(validateConfig({ heat: 1 }, manifest)), []);
});

test('on incomplete input a companion may be in the part not extracted: rule findings are unresolved', () => {
	const result = validateConfig({ heat: 1, legend: 'b', name: 'a' }, manifest, { incomplete: true }, RULES);
	assert.deepEqual(findings(result), [
		'warning unknown CFG_REQUIRES $.heat',
		'warning unknown CFG_UNKNOWN_REFERENCE $.legend'
	]);
});

test('rules speak for the schema version: downgraded for another minor, not run for another major', () => {
	const minor = validateConfig({ heat: 1 }, manifest, { libraryVersion: '1.1.0' }, RULES);
	assert.deepEqual(findings(minor), ['warning unknown CFG_VERSION_MISMATCH $', 'warning unknown CFG_REQUIRES $.heat']);
	const major = validateConfig({ heat: 1 }, manifest, { libraryVersion: '2.0.0' }, RULES);
	assert.deepEqual(findings(major), ['warning unknown CFG_UNSUPPORTED_VERSION $']);
});

test('rules read the registry context: registered by name or subtype, undefined without a complete registry', () => {
	const seen = [];
	const probe = [
		{
			id: 'test/probe',
			check: (_, context) => (seen.push([context.registered('r', 'a'), context.registered('r', 'b')]), [])
		}
	];
	validateConfig({}, manifest, { registries: { r: { names: ['a.sub'], complete: true } } }, probe);
	validateConfig({}, manifest, { registries: { r: { names: ['a'], complete: false } } }, probe);
	validateConfig({}, manifest, {}, probe);
	assert.deepEqual(seen, [
		[true, false],
		[undefined, undefined],
		[undefined, undefined]
	]);
});

test('readOwn reads own data values only: absent is known undefined, a getter or a non-object step is unknown', () => {
	let ran = false;
	const getter = Object.defineProperty({}, 'type', { enumerable: true, get: () => ((ran = true), 'x') });
	assert.deepEqual(readOwn({ a: { b: 1 } }, 'a', 'b'), { known: true, value: 1 });
	assert.deepEqual(readOwn({ a: {} }, 'a', 'b'), { known: true, value: undefined });
	assert.deepEqual(readOwn({}, 'a', 'b'), { known: true, value: undefined });
	assert.deepEqual(readOwn({ a: [5, 6] }, 'a', 1), { known: true, value: 6 });
	assert.deepEqual(readOwn({ a: ['pie'] }, 'a', 'type'), { known: false });
	assert.deepEqual(readOwn(getter, 'type'), { known: false });
	assert.deepEqual(readOwn({ a: 'text' }, 'a', 'length'), { known: false });
	// The runtime would read an inherited `a`: an object with its own prototype is not plain data.
	assert.deepEqual(readOwn(Object.create({ a: 1 }), 'a'), { known: false });
	assert.deepEqual(readOwn(Object.create(null), 'a'), { known: true, value: undefined });
	assert.equal(ran, false);
});

test('itemsOf: one object or a list of them, with the path of each; unknown for holes, getters and other values', () => {
	assert.deepEqual(itemsOf({ type: 'line' }, '$.series'), [{ path: '$.series', index: 0, value: { type: 'line' } }]);
	assert.deepEqual(itemsOf([{ a: 1 }, { b: 2 }], '$.series'), [
		{ path: '$.series[0]', index: 0, value: { a: 1 } },
		{ path: '$.series[1]', index: 1, value: { b: 2 } }
	]);
	assert.deepEqual(itemsOf(undefined, '$.series'), []);
	const holed = [1, 2, 3];
	delete holed[1];
	for (const unknown of [holed, Object.defineProperty([1], '0', { get: () => 1 }), 'x', 7])
		assert.equal(itemsOf(unknown, '$.s'), undefined);
});

test('plain data from another realm (an iframe, a vm context) is read like plain data from this one', () => {
	const foreign = vm.runInNewContext('({ chart: { type: "pie" }, series: [{ data: [1] }] })');
	assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
	assert.deepEqual(readOwn(foreign, 'chart', 'type'), { known: true, value: 'pie' });
	assert.deepEqual(itemsOf(readOwn(foreign, 'series').value, '$.series').length, 1);
	// Still not plain: a class instance, or an object inheriting data, from either realm.
	assert.deepEqual(readOwn(vm.runInNewContext('new (class { constructor() { this.a = 1; } })()'), 'a'), {
		known: false
	});
	assert.deepEqual(readOwn(vm.runInNewContext('Object.create({ a: 1 })'), 'a'), { known: false });
	assert.deepEqual(readOwn(Object.create(Object.create(null, { a: { value: 1, enumerable: true } })), 'a'), {
		known: false
	});
});
