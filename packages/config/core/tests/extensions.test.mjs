import assert from 'node:assert/strict';
import test from 'node:test';

import { ExtensionError, lowerArtifact, s, validateConfig, withExtensions } from '../dist/index.js';
import { artifact, problems, prop } from './fixtures.mjs';

/** A library with a plugin-options point (`plugins`) and a series registry (`demo`, `series.<type>`). */
function manifest() {
	const plugins = {
		...s.object({ legend: s.object({ display: s.boolean() }) }, { additional: 'allow' }),
		extensionPoint: 'demo.plugins'
	};
	const line = s.object({ type: s.string(['line']), width: s.number() });
	const series = s.union([line], {
		discriminator: 'type',
		extensible: true,
		registry: { id: 'demo', prefix: 'series.', enforced: true },
		extensionPoint: 'demo'
	});
	const root = s.object({ plugins, series: s.array(series) }, { additional: 'allow' });
	return { library: 'demo', version: '1.0.0', coverage: 'partial', source: 'demo@1.0.0', root };
}
const LABELS = { id: 'demo-labels', options: { 'demo.plugins': { labels: s.object({ size: s.number() }) } } };
const CLOUD = { id: 'demo-cloud', variants: { demo: { 'series.cloud': s.object({ words: s.array(s.string()) }) } } };
const findings = (schema, config, options) =>
	validateConfig(config, schema, options).diagnostics.map((d) => `${d.code} ${d.path}`);

test('an option extension is checked at its point; without it the open point accepts anything', () => {
	const extended = withExtensions(manifest(), [LABELS]);
	assert.deepEqual(findings(extended, { plugins: { labels: { size: 'x', colour: 1 } } }), [
		'CFG_TYPE $.plugins.labels.size',
		'CFG_UNKNOWN_KEY $.plugins.labels.colour'
	]);
	assert.deepEqual(findings(manifest(), { plugins: { labels: { size: 'x' } } }), []);
	// The built-in option at the same point is untouched.
	assert.deepEqual(findings(extended, { plugins: { legend: { display: 'no' } } }), [
		'CFG_TYPE $.plugins.legend.display'
	]);
});

test('a variant extension is selected by its discriminator; the discriminator literal is added for it', () => {
	const extended = withExtensions(manifest(), [CLOUD]);
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', words: [1] }] }), ['CFG_TYPE $.series[0].words[0]']);
	assert.deepEqual(findings(extended, { series: [{ type: 'line', width: 'x' }] }), ['CFG_TYPE $.series[0].width']);
	assert.deepEqual(findings(manifest(), { series: [{ type: 'cloud', words: [1] }] }), [
		'CFG_UNKNOWN_VARIANT $.series[0].type'
	]);
	const typed = {
		id: 'demo-typed',
		variants: { demo: { 'series.cloud': s.object({ type: s.string(['cloud']), words: s.array(s.string()) }) } }
	};
	assert.deepEqual(findings(withExtensions(manifest(), [typed]), { series: [{ type: 'cloud', words: ['a'] }] }), []);
});

test('the result names the extensions it was validated with; the base schema is not changed', () => {
	const base = manifest();
	const extended = withExtensions(base, [LABELS, CLOUD]);
	const result = validateConfig({}, extended);
	assert.deepEqual(result.extensions, ['demo-labels', 'demo-cloud']);
	assert.equal(validateConfig({}, base).extensions, undefined);
	assert.deepEqual(findings(base, { series: [{ type: 'cloud' }] }), ['CFG_UNKNOWN_VARIANT $.series[0].type']);
});

test('a registry context still applies to an extension variant', () => {
	const extended = withExtensions(manifest(), [CLOUD]);
	const registries = (names) => ({ registries: { demo: { names, complete: true } } });
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', words: [] }] }, registries(['series.line'])), [
		'CFG_UNREGISTERED $.series[0].type'
	]);
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', words: [] }] }, registries(['series.cloud'])), []);
});

test('the precedence policy: built-ins cannot be replaced, a name has one owner, only declared points and registries', () => {
	const refused = (extensions) => {
		try {
			withExtensions(manifest(), extensions);
		} catch (error) {
			assert.ok(error instanceof ExtensionError);
			return error.problems;
		}
		return [];
	};
	assert.deepEqual(refused([{ id: 'x', options: { 'demo.plugins': { legend: s.object({}) } } }]), [
		'x: "legend" is a built-in option of demo.plugins and cannot be replaced'
	]);
	assert.deepEqual(refused([{ id: 'x', variants: { demo: { 'series.line': s.object({}) } } }]), [
		'x: "series.line" is a built-in variant of demo and cannot be replaced'
	]);
	assert.deepEqual(refused([LABELS, { ...LABELS, id: 'other' }]), [
		'demo-labels, other: both define "labels" at demo.plugins'
	]);
	assert.deepEqual(refused([{ id: 'x', options: { 'demo.nope': { a: s.object({}) } } }]), [
		'x: no extension point demo.nope (known: demo.plugins)'
	]);
	assert.deepEqual(refused([{ id: 'x', variants: { nope: { 'series.a': s.object({}) } } }]), [
		'x: no registry nope (known: demo)'
	]);
	assert.deepEqual(refused([{ id: 'x', variants: { demo: { cloud: s.object({}) } } }]), [
		'x: "cloud" has none of the prefixes of demo (series.)'
	]);
	assert.deepEqual(refused([{ id: 'x', variants: { demo: { 'series.cloud': s.number() } } }]), [
		'x: variant "series.cloud" must be an object schema'
	]);
	assert.deepEqual(
		refused([{ id: 'x', variants: { demo: { 'series.cloud': s.object({ type: s.string(['rain']) }) } } }]),
		['x: variant "series.cloud" declares type "rain", not "cloud"']
	);
	assert.deepEqual(refused([{ id: '', options: {} }]), ['an extension needs a non-empty id']);
});

test('an option or variant that is not a schema is refused at setup, not met during a walk', () => {
	const refusal = (extension) => assert.throws(() => withExtensions(manifest(), [extension]), ExtensionError);
	refusal({ id: 'x', options: { 'demo.plugins': { labels: { size: 'number' } } } });
	refusal({ id: 'x', options: { 'demo.plugins': { labels: null } } });
	refusal({ id: 'x', variants: { demo: { 'series.cloud': 'object' } } });
	assert.throws(
		() => withExtensions(manifest(), [{ id: 'x', options: { 'demo.plugins': { labels: 1 } } }]),
		(error) => {
			assert.deepEqual(error.problems, ['x: option "labels" at demo.plugins is not a schema']);
			return true;
		}
	);
});

test("a named extension option wins over the point's catch-all values schema", () => {
	const base = manifest();
	const plugins = { ...s.object({}, { additional: 'allow' }), values: s.boolean(), extensionPoint: 'demo.plugins' };
	const open = { ...base, root: s.object({ plugins }) };
	const extended = withExtensions(open, [LABELS]);
	assert.deepEqual(findings(extended, { plugins: { labels: { size: 1 }, other: true } }), []);
	assert.deepEqual(findings(extended, { plugins: { labels: { size: 'x' }, other: 1 } }), [
		'CFG_TYPE $.plugins.labels.size',
		'CFG_TYPE $.plugins.other'
	]);
});

test('a cyclic, shared schema is catalogued once and left unchanged', () => {
	const node = { ...s.object({ name: s.string() }, { additional: 'allow' }), extensionPoint: 'demo.plugins' };
	node.properties.child = node;
	const cyclic = { ...manifest(), root: s.object({ a: node, b: node }) };
	const extended = withExtensions(cyclic, [LABELS]);
	assert.deepEqual(findings(extended, { a: { child: { child: { labels: { size: 'x' } } } }, b: { labels: {} } }), [
		'CFG_TYPE $.a.child.child.labels.size'
	]);
	assert.equal(node.properties.labels, undefined);
	assert.equal(node.properties.child, node);
});

test('extensions accumulate: a second withExtensions keeps the first and re-checks the whole list', () => {
	const once = withExtensions(manifest(), [LABELS]);
	const twice = withExtensions(once, [CLOUD]);
	assert.deepEqual(validateConfig({}, twice).extensions, ['demo-labels', 'demo-cloud']);
	assert.throws(() => withExtensions(once, [{ ...LABELS, id: 'again' }]), ExtensionError);
});

test('a registry takes variants only where the schema marks it: an unmarked one is refused like an unknown one', () => {
	const base = manifest();
	const series = { ...base.root.properties.series.element };
	delete series.extensionPoint;
	const unmarked = { ...base, root: s.object({ series: s.array(series) }) };
	assert.throws(
		() => withExtensions(unmarked, [CLOUD]),
		(error) => {
			assert.deepEqual(error.problems, ['demo-cloud: no registry demo (known: none)']);
			return true;
		}
	);
});

/** An artifact with an option point and a marked series registry, as the generators emit them. */
function generated({ point = 'demo.plugins', variantPoint = 'demo' } = {}) {
	const member = (type) => ({
		kind: 'object',
		additional: 'closed',
		properties: { type: prop({ kind: 'literal', value: type }) }
	});
	const series = {
		kind: 'union',
		anyOf: [{ kind: 'ref', ref: 'Line' }],
		discriminator: 'type',
		extensible: true,
		registry: { id: 'demo', prefix: 'series.', enforced: true },
		extensionPoint: variantPoint
	};
	const plugins = { kind: 'object', additional: 'open', properties: {}, extensionPoint: point };
	const root = {
		kind: 'object',
		additional: 'closed',
		properties: { plugins: prop(plugins), series: prop({ kind: 'array', items: series }) }
	};
	return artifact(root, { definitions: { Line: member('line') } });
}

test('artifacts carry both kinds of point through lowering; a malformed point is an artifact problem', () => {
	const { manifest: lowered } = lowerArtifact(generated());
	const extended = withExtensions(lowered, [LABELS, CLOUD]);
	assert.deepEqual(
		findings(extended, { plugins: { labels: { size: 'x' } }, series: [{ type: 'cloud', words: [2] }] }),
		['CFG_TYPE $.plugins.labels.size', 'CFG_TYPE $.series[0].words[0]']
	);
	assert.deepEqual(problems(generated({ point: '' })), [
		'$.root.properties.plugins.node: extensionPoint must be a non-empty string'
	]);
	// A union's point may differ from its registry id (CG-02-05 part 2), but it needs a registry.
	assert.deepEqual(problems(generated({ variantPoint: 'other' })), []);
	assert.deepEqual(problems(generated({ variantPoint: '' })), [
		'$.root.properties.series.node.items: a union extensionPoint must be a non-empty string on a union with a registry'
	]);
});

test('built-in names are collected from every object of a point and through nested unions', () => {
	// Chart.js marks `options.plugins` of every chart type: a built-in of any of them is a built-in of the point.
	const point = (name) => ({
		...s.object({ [name]: s.object({}) }, { additional: 'allow' }),
		extensionPoint: 'demo.plugins'
	});
	const area = s.object({ type: s.string(['area']) });
	const nested = s.union([s.object({ type: s.string(['line']) }), area], { discriminator: 'type' });
	// `T | T[]`: the list member has no discriminator and adds no name.
	const series = s.union([nested, area, s.array(area)], {
		discriminator: 'type',
		extensible: true,
		registry: { id: 'demo', prefix: 'series.', enforced: true },
		extensionPoint: 'demo'
	});
	const root = s.object({ bar: point('legend'), pie: point('title'), series: s.array(series) });
	const refused = (extension) => {
		try {
			withExtensions({ ...manifest(), root }, [extension]);
		} catch (error) {
			return error.problems;
		}
		return [];
	};
	assert.deepEqual(refused({ id: 'x', options: { 'demo.plugins': { legend: s.object({}), title: s.object({}) } } }), [
		'x: "legend" is a built-in option of demo.plugins and cannot be replaced',
		'x: "title" is a built-in option of demo.plugins and cannot be replaced'
	]);
	assert.deepEqual(
		refused({ id: 'x', variants: { demo: { 'series.line': s.object({}), 'series.area': s.object({}) } } }),
		[
			'x: "series.line" is a built-in variant of demo and cannot be replaced',
			'x: "series.area" is a built-in variant of demo and cannot be replaced'
		]
	);
});
