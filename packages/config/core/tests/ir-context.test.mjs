import assert from 'node:assert/strict';
import test from 'node:test';

import { manifestFromArtifact, validateConfig } from '../dist/index.js';
import { artifact, problems, prop } from './fixtures.mjs';

// IR fields that tie a schema to its runtime context: registries, handlers and defaults read elsewhere.
test('a union registry lowers unchanged and is checked against the caller registry context', () => {
	const variant = (value) => ({
		kind: 'object',
		additional: 'unknown',
		properties: { type: prop({ kind: 'literal', value }) }
	});
	const root = {
		kind: 'union',
		anyOf: [variant('bar'), variant('line')],
		discriminator: 'type',
		extensible: true,
		registry: { id: 'test', prefix: 'series.', enforced: true }
	};
	assert.deepEqual(problems(artifact(root)), []);
	const manifest = manifestFromArtifact(artifact(root));
	assert.deepEqual(manifest.root.registry, { id: 'test', prefix: 'series.', enforced: true });
	const registries = { test: { names: ['series.line'], complete: true } };
	assert.deepEqual(
		validateConfig({ type: 'bar' }, manifest, { registries }).diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_UNREGISTERED $.type']
	);
	for (const [registry, extra] of [
		[{ id: '', prefix: '' }, {}],
		[{ id: 'test' }, {}],
		[{ id: 'test', prefix: '' }, {}],
		['test', {}]
	])
		assert.deepEqual(problems(artifact({ ...root, registry, ...extra })), [
			'$.root: registry must be { id: <non-empty string>, prefix: <string>, enforced: <boolean> }'
		]);
	for (const extra of [{ extensible: false }, { discriminator: undefined }])
		assert.deepEqual(problems(artifact({ ...root, ...extra })), [
			'$.root: a registry needs a discriminator and extensible: true'
		]);
});

test('a property handler lowers onto the value and is checked against a complete registry', () => {
	const handledBy = { id: 'test', name: 'title', enforced: true };
	const root = {
		kind: 'object',
		additional: 'open',
		properties: { title: { ...prop({ kind: 'object', additional: 'open', properties: {} }), handledBy } }
	};
	assert.deepEqual(problems(artifact(root)), []);
	const manifest = manifestFromArtifact(artifact(root));
	assert.deepEqual(manifest.root.properties.title.handledBy, handledBy);
	const registries = { test: { names: [], complete: true } };
	assert.deepEqual(
		validateConfig({ title: {} }, manifest, { registries }).diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_UNREGISTERED $.title']
	);
	for (const bad of [{ id: 'test', name: '', enforced: true }, { id: 'test', name: 'title' }, 'title'])
		assert.deepEqual(
			problems(artifact({ ...root, properties: { title: { ...root.properties.title, handledBy: bad } } })),
			[
				'$.root.properties.title: handledBy must be { id: <non-empty string>, name: <non-empty string>, enforced: <boolean> }'
			]
		);
});

/** Series whose type defaults to `chart.type`, else `line`, as in Highcharts. */
function seriesRoot(defaultFrom = { path: ['chart', 'type'], fallback: 'line' }) {
	const variant = (value, extra) => ({
		kind: 'object',
		additional: 'unknown',
		properties: { type: prop({ kind: 'literal', value }), ...extra }
	});
	const series = {
		kind: 'union',
		anyOf: [variant('line', { step: prop({ kind: 'boolean' }) }), variant('pie', {})],
		discriminator: 'type',
		defaultFrom
	};
	const chart = prop({ kind: 'object', additional: 'open', properties: {} });
	return { kind: 'object', additional: 'open', properties: { chart, series: prop({ kind: 'array', items: series }) } };
}

test('a default named elsewhere lowers unchanged and selects from the root', () => {
	assert.deepEqual(problems(artifact(seriesRoot())), []);
	const manifest = manifestFromArtifact(artifact(seriesRoot()));
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ series: [{ step: 'x' }] }), ['CFG_TYPE $.series[0].step']);
	assert.deepEqual(codes({ chart: { type: 'pie' }, series: [{ step: 'x' }] }), ['CFG_UNKNOWN_KEY $.series[0].step']);
});

test('a default named elsewhere needs a path, a literal fallback and a discriminator', () => {
	const at = '$.root.properties.series.node.items';
	const message = `${at}: defaultFrom must be { path: <non-empty property names>, fallback: <literal> }`;
	for (const bad of [
		{ path: [], fallback: 'line' },
		{ path: ['chart', ''], fallback: 'line' },
		{ path: ['chart'] },
		'chart.type'
	])
		assert.deepEqual(problems(artifact(seriesRoot(bad))), [message], JSON.stringify(bad));
	const undiscriminated = seriesRoot();
	delete undiscriminated.properties.series.node.items.discriminator;
	assert.ok(problems(artifact(undiscriminated)).includes(`${at}: defaultFrom needs a discriminator`));
});

test('nullAsAbsent lowers onto the object and must be a boolean', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		nullAsAbsent: true,
		properties: { color: prop({ kind: 'string' }) }
	};
	assert.deepEqual(problems(artifact(root)), []);
	const manifest = manifestFromArtifact(artifact(root));
	assert.equal(manifest.root.nullAsAbsent, true);
	assert.deepEqual(validateConfig({ color: null }, manifest).diagnostics, []);
	assert.deepEqual(problems(artifact({ ...root, nullAsAbsent: 'yes' })), ['$.root: nullAsAbsent must be a boolean']);
});
