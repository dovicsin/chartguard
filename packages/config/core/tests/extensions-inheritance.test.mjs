import assert from 'node:assert/strict';
import test from 'node:test';

import { ExtensionError, s, validateConfig, withExtensions } from '../dist/index.js';

/** Series in registry `demo` (`series.<type>`), open to variants at the point `demo.series`; the series type defaults from `chart.type`. */
function manifest() {
	const line = s.object({ type: s.string(['line']), width: s.number(), data: s.array(s.number()) });
	const area = s.object({ type: s.string(['area']), fill: s.boolean() });
	const series = s.union([line, area], {
		discriminator: 'type',
		extensible: true,
		registry: { id: 'demo', prefix: 'series.', enforced: true },
		extensionPoint: 'demo.series'
	});
	const withDefault = { ...series, defaultFrom: { path: ['chart', 'type'], fallback: 'line' } };
	const root = s.object({ chart: s.object({ type: s.string() }), series: s.array(withDefault) });
	return { library: 'demo', version: '1.0.0', coverage: 'partial', source: 'demo@1.0.0', root };
}
const findings = (schema, config, options) =>
	validateConfig(config, schema, options).diagnostics.map((d) => `${d.code} ${d.path}`);
const refusal = (extensions) => {
	try {
		withExtensions(manifest(), extensions);
	} catch (error) {
		assert.ok(error instanceof ExtensionError);
		return error.problems;
	}
	return assert.fail('expected an ExtensionError');
};
const CLOUD = {
	id: 'cloud',
	variants: {
		'demo.series': { 'series.cloud': { extends: 'series.line', schema: s.object({ words: s.array(s.string()) }) } }
	}
};

test('a variant point is named by the schema; registration still uses the registry it belongs to', () => {
	const extended = withExtensions(manifest(), [
		{ id: 'x', variants: { 'demo.series': { 'series.cloud': s.object({ words: s.array(s.string()) }) } } }
	]);
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', words: [1] }] }), ['CFG_TYPE $.series[0].words[0]']);
	const registries = { registries: { demo: { names: ['series.line'], complete: true } } };
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', words: [] }] }, registries), [
		'CFG_UNREGISTERED $.series[0].type'
	]);
	assert.deepEqual(refusal([{ id: 'x', variants: { demo: { 'series.cloud': s.object({}) } } }]), [
		'x: no registry demo (known: demo.series)'
	]);
});

test('a variant extending a built-in inherits its options and adds its own', () => {
	const extended = withExtensions(manifest(), [CLOUD]);
	assert.deepEqual(findings(extended, { series: [{ type: 'cloud', width: 'wide', data: [1, 'x'], words: [2] }] }), [
		'CFG_TYPE $.series[0].width',
		'CFG_TYPE $.series[0].data[1]',
		'CFG_TYPE $.series[0].words[0]'
	]);
	// The built-in is unchanged: a line has no words, a cloud is not a line.
	assert.deepEqual(findings(extended, { series: [{ type: 'line', words: [] }] }), [
		'CFG_UNKNOWN_KEY $.series[0].words'
	]);
	// An extension property replaces the built-in one of the same name.
	const wider = {
		id: 'w',
		variants: { 'demo.series': { 'series.wide': { extends: 'series.line', schema: s.object({ width: s.string() }) } } }
	};
	assert.deepEqual(findings(withExtensions(manifest(), [wider]), { series: [{ type: 'wide', width: 'wide' }] }), []);
});

test('extends must name a built-in variant of the same point, and add an object schema', () => {
	assert.deepEqual(
		refusal([{ id: 'x', variants: { 'demo.series': { 'series.cloud': { extends: 'series.nope' } } } }]),
		['x: "series.cloud" extends "series.nope", which is not a built-in variant of demo.series']
	);
	assert.deepEqual(
		refusal([
			{ id: 'x', variants: { 'demo.series': { 'series.cloud': { extends: 'series.line', schema: s.number() } } } }
		]),
		['x: variant "series.cloud" must be an object schema']
	);
	assert.deepEqual(
		refusal([
			{
				id: 'x',
				variants: { 'demo.series': { 'series.cloud': { extends: 'series.cloud2' }, 'series.cloud2': s.object({}) } }
			}
		]),
		['x: "series.cloud" extends "series.cloud2", which is not a built-in variant of demo.series']
	);
	// Without a schema, the variant is the built-in under a new name.
	const renamed = withExtensions(manifest(), [
		{ id: 'x', variants: { 'demo.series': { 'series.spline': { extends: 'series.line' } } } }
	]);
	assert.deepEqual(findings(renamed, { series: [{ type: 'spline', width: 'x' }] }), ['CFG_TYPE $.series[0].width']);
});

test('a default that names an extension variant selects it', () => {
	const extended = withExtensions(manifest(), [CLOUD]);
	assert.deepEqual(findings(extended, { chart: { type: 'cloud' }, series: [{ words: [1] }] }), [
		'CFG_TYPE $.series[0].words[0]'
	]);
	assert.deepEqual(findings(manifest(), { chart: { type: 'cloud' }, series: [{ words: [1] }] }), [
		'CFG_AMBIGUOUS $.series[0]'
	]);
});
