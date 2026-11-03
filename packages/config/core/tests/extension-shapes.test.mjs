import assert from 'node:assert/strict';
import test from 'node:test';

import { ExtensionError, s, validateConfig, withExtensions } from '../dist/index.js';

/**
 * A plugin's schema has the engine's shape all the way down (C6): a node the engine cannot read is a
 * setup problem naming where it is, never a raw exception during a walk and never a confident finding
 * made from a malformed schema (`{ kind: 'weird' }` used to report every value as `CFG_TYPE`).
 */
function manifest() {
	const plugins = { ...s.object({}, { additional: 'allow' }), extensionPoint: 'demo.plugins' };
	const line = s.object({ type: s.string(['line']) });
	const series = s.union([line], {
		discriminator: 'type',
		extensible: true,
		registry: { id: 'demo', prefix: 'series.', enforced: true },
		extensionPoint: 'demo'
	});
	return {
		library: 'demo',
		version: '1.0.0',
		coverage: 'partial',
		source: 'demo@1.0.0',
		root: s.object({ plugins, series: s.array(series) }, { additional: 'allow' })
	};
}

const problemsOf = (schema, place = 'options') => {
	const extension =
		place === 'options'
			? { id: 'x', options: { 'demo.plugins': { labels: schema } } }
			: { id: 'x', variants: { demo: { 'series.cloud': schema } } };
	try {
		withExtensions(manifest(), [extension]);
		return [];
	} catch (error) {
		assert.ok(error instanceof ExtensionError, `${String(error)}`);
		return error.problems;
	}
};

test('every malformed node is refused with the path to it, at setup', () => {
	const cases = [
		[
			{ kind: 'weird' },
			'labels: kind "weird" is not one of object, array, string, number, boolean, null, function, union, any'
		],
		[{ kind: 'union', anyOf: 5 }, 'labels: anyOf must be a non-empty list of schemas'],
		[{ kind: 'union', anyOf: [] }, 'labels: anyOf must be a non-empty list of schemas'],
		[{ kind: 'object', properties: null }, 'labels: properties must be an object of schemas by name'],
		[s.object({ size: { kind: 'numbr' } }), 'labels.properties.size: kind "numbr" is not one of'],
		[{ kind: 'object', propertes: {} }, 'labels: unknown field "propertes"'],
		[{ kind: 'array', element: 'number' }, 'labels.element: not a schema (an object with a kind)'],
		[{ kind: 'string', enum: ['a', {}] }, 'labels: enum must be a list of strings, numbers and booleans'],
		[s.object({}, { additional: 'maybe' }), 'labels: additionalProperties must be one of allow, warn, deny'],
		[{ ...s.object({}), required: 'a' }, 'labels: required must be a list of property names'],
		[
			s.union([s.object({ a: s.string(['p']) })], { discriminator: 'a', registry: 'demo.series' }),
			'labels: registry must be { id: string, prefix: string, enforced: boolean }'
		],
		[s.union([s.object({})], { defaultVariant: 3 }), 'labels: defaultVariant must be an index of anyOf (0..0)'],
		[
			{ ...s.union([s.object({})]), defaultWhen: [{ test: 'often', property: 'a', variant: 0 }] },
			'labels: defaultWhen[0] must be { test: truthy | nonEmpty | positive, property: string, variant: an index of anyOf }'
		],
		[{ kind: 'string', discriminator: 'type' }, 'labels: discriminator belongs to a union, not a string'],
		[{ kind: 'number', inferred: 'yes' }, 'labels: inferred must be true'],
		[{ kind: 'object', values: 1 }, 'labels.values: not a schema (an object with a kind)'],
		[
			{ kind: 'string', deprecated: { since: 2 } },
			'labels: deprecated must be { since?, replacement?, message?, renameTo? } of strings'
		]
	];
	for (const [schema, expected] of cases) {
		const [problem, ...rest] = problemsOf(schema);
		assert.ok(
			problem?.startsWith(`x: option "labels" at demo.plugins: ${expected}`),
			`${JSON.stringify(schema)}\n  got: ${String(problem)}`
		);
		assert.deepEqual(rest, [], JSON.stringify(schema));
	}
});

test('a variant is checked the same way, below its discriminator', () => {
	assert.deepEqual(problemsOf(s.object({ words: { kind: 'list' } }), 'variants'), [
		'x: variant "series.cloud" of demo: series.cloud.properties.words: kind "list" is not one of object, array, string, number, boolean, null, function, union, any'
	]);
});

test('what the builders write, a recursive schema and every documented field are accepted', () => {
	const node = s.object({ name: s.string(), size: s.number() }, { required: ['name'], additional: 'deny' });
	const tree = { ...s.object({ label: s.string() }) };
	tree.properties.children = s.array(tree);
	const accepted = [
		node,
		tree,
		s.union([s.object({ type: s.string(['a']) }), s.object({ type: s.string(['b']) })], {
			discriminator: 'type',
			defaultVariant: 1,
			extensible: true
		}),
		{ ...s.object({}), inferred: true, nullAsAbsent: true, doc: 'text', values: s.number(), skips: ['null'] },
		{ ...s.number(), deprecated: { since: '2.0.0', replacement: 'size', message: 'use size', renameTo: 'size' } },
		{ kind: 'any' },
		{ kind: 'function' }
	];
	for (const schema of accepted)
		assert.deepEqual(
			problemsOf(schema),
			[],
			JSON.stringify(schema, (_, v) => (v === tree ? '<tree>' : v))
		);
	const extended = withExtensions(manifest(), [{ id: 'x', options: { 'demo.plugins': { tree } } }]);
	assert.deepEqual(
		validateConfig({ plugins: { tree: { label: 'a', children: [{ label: 1 }] } } }, extended).diagnostics.map(
			(d) => `${d.code} ${d.path}`
		),
		['CFG_TYPE $.plugins.tree.children[0].label']
	);
});

test('a schema too deep or too large to check is refused, never walked unbounded', () => {
	let deep = s.number();
	for (let index = 0; index < 300; index++) deep = s.object({ next: deep });
	assert.match(problemsOf(deep)[0] ?? '', /deeper than 256 levels/u);
	const wide = s.object(
		Object.fromEntries(Array.from({ length: 120_000 }, (_, index) => [`k${String(index)}`, s.number()]))
	);
	assert.match(problemsOf(wide)[0] ?? '', /more than 100000 nodes/u);
});
