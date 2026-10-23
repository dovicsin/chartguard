import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';
import { verifiedUpstream } from '@chartguard/schema-generator';

import { generate, run } from '../generate.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const first = generate(ROOT, 'chartjs');
const artifact = JSON.parse(first.text);

test('generation is deterministic and matches the committed artifact', () => {
	assert.equal(generate(ROOT, 'chartjs').text, first.text);
	assert.equal(readFileSync(first.path, 'utf8'), first.text);
	assert.deepEqual(run('check', ['chartjs']), []);
});

test('definition names are bounded, unique and never truncated into collisions', () => {
	const names = Object.keys(artifact.definitions);
	assert.equal(new Set(names).size, names.length);
	for (const name of names) assert.ok(name.length <= 140, name);
	const hashed = names.filter((name) => name.includes('…#'));
	assert.ok(hashed.every((name) => /…#[0-9a-f]{10}(~\d+)?$/.test(name)));
});

test('platform object types are shared definitions, not thousands of inline copies', () => {
	const inlineOpen = (node) => {
		if (node === null || typeof node !== 'object') return 0;
		const own =
			node.kind === 'object' && node.additional === 'open' && Object.keys(node.properties).length === 0 ? 1 : 0;
		return own + Object.values(node).reduce((sum, child) => sum + inlineOpen(child), 0);
	};
	const nested = Object.values(artifact.definitions).reduce(
		(sum, definition) => sum + Object.values(definition).reduce((inner, child) => inner + inlineOpen(child), 0),
		0
	);
	assert.equal(nested, 0);
	const gradient = Object.keys(artifact.definitions).filter(
		(name) => name.includes('CanvasGradient') && artifact.definitions[name].kind === 'object'
	);
	assert.ok(gradient.length > 0);
	for (const name of gradient)
		assert.deepEqual(artifact.definitions[name], {
			kind: 'object',
			additional: 'open',
			properties: {},
			host: 'CanvasGradient'
		});
});

test("an empty open definition is only an object TypeScript's library declares: a platform class or an options dictionary, never a mapped type (D3, D6)", () => {
	const empty = Object.entries(artifact.definitions)
		.filter(
			([, node]) => node.kind === 'object' && node.additional === 'open' && Object.keys(node.properties).length === 0
		)
		.map(([name, node]) => `${name} ${node.host ?? '-'}`);
	assert.deepEqual(empty.sort(), [
		'_DeepPartialObject<CanvasGradient> CanvasGradient',
		'_DeepPartialObject<CanvasPattern> CanvasPattern',
		'_DeepPartialObject<HTMLCanvasElement> HTMLCanvasElement',
		'_DeepPartialObject<HTMLImageElement> HTMLImageElement',
		'_DeepPartialObject<NumberFormatOptions> -'
	]);
});

test('the artifact is well-formed and pinned to the verified upstream package', () => {
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.equal(artifact.libraryVersion, '4.5.1');
	assert.equal(artifact.coverage, 'partial');
	assert.deepEqual(artifact.sources.chartjs, {
		kind: 'npm-package',
		locator: 'chart.js@4.5.1',
		integrity: verifiedUpstream(ROOT, 'chartjs').integrity,
		license: 'MIT'
	});
});

/** Follows a shared-definition reference (large unions are stored once and referenced) and unwraps `scriptable`. */
const resolve = (node) => {
	const target = node.kind === 'ref' ? artifact.definitions[node.ref] : node;
	return target.kind === 'scriptable' ? resolve(target.value) : target;
};

function provenances(node) {
	if (node === null || typeof node !== 'object') return [];
	const own = node.provenance === undefined ? [] : [node.provenance];
	return [...own, ...Object.values(node).flatMap(provenances)];
}

test('every authoritative fact points at a declaration inside the chart.js package', () => {
	const all = provenances(artifact.definitions);
	assert.ok(all.length > 1000);
	assert.ok(all.every(({ confidence, sources }) => confidence === 'authoritative' && sources[0].source === 'chartjs'));
	const pointers = all.map(({ sources }) => sources[0].pointer);
	assert.ok(pointers.every((pointer) => typeof pointer === 'string' && pointer.startsWith('chart.js/')));
});

test('scale unions are extensible, datasets inherit the chart type, runtime-defaulted keys are optional', () => {
	const bar = artifact.definitions.Config_bar;
	assert.equal(bar.properties.data.required, undefined);
	const data = artifact.definitions[bar.properties.data.node.ref];
	assert.equal(data.properties.datasets.required, undefined);
	const options = resolve(bar.properties.options.node);
	const scales = resolve(options.properties.scales.node);
	assert.equal(scales.kind, 'record');
	const scale = resolve(scales.values);
	assert.deepEqual([scale.discriminator, scale.extensible], ['type', true]);
});

test('every option value under options is scriptable; discriminators stay literal', () => {
	const options = resolve(artifact.definitions.Config_line.properties.options.node);
	const title = resolve(resolve(options.properties.plugins.node).properties.title.node)
		.anyOf.map(resolve)
		.find((member) => member.kind === 'object');
	assert.equal(title.properties.text.node.kind, 'scriptable');
	assert.equal(options.properties.responsive.node.kind, 'scriptable');
	assert.equal(artifact.definitions.Config_line.properties.type.node.kind, 'literal');
	const scale = resolve(resolve(options.properties.scales.node).values).anyOf.map(resolve)[0];
	assert.equal(scale.properties.type.node.kind, 'literal');
});

test('a built-in plugin entry may be a boolean: getOpts disables it with false and enables it with true', () => {
	const options = resolve(artifact.definitions.Config_bar.properties.options.node);
	const plugins = resolve(options.properties.plugins.node);
	for (const id of ['legend', 'tooltip', 'title', 'subtitle', 'decimation', 'filler', 'colors']) {
		const members = resolve(plugins.properties[id].node).anyOf.map(resolve);
		assert.ok(
			members.some((member) => member.kind === 'boolean'),
			id
		);
	}
});

test('the artifact never embeds local paths', () => {
	assert.equal(first.text.includes(ROOT), false);
	assert.equal(first.text.includes('__chartguard_schema_entry__'), false);
	assert.doesNotMatch(first.text, /"pointer": "\//);
});

test('the root is an extensible union over the registered chart types', () => {
	const { root, definitions } = artifact;
	assert.equal(root.discriminator, 'type');
	assert.equal(root.extensible, true);
	const types = root.anyOf.map(({ ref }) => definitions[ref].properties.type.node.value);
	assert.deepEqual(types, ['bar', 'bubble', 'doughnut', 'line', 'pie', 'polarArea', 'radar', 'scatter']);
});

test('chart, dataset and scale types name the runtime registry they are looked up in, citing the lookup', () => {
	const pointer = (node) => node.provenance.sources[0].pointer;
	// The chart type is only read through its datasets, so it recognises extensions but is not enforced.
	assert.deepEqual(artifact.root.registry, { id: 'chartjs.controllers', prefix: '', enforced: false });
	assert.match(pointer(artifact.root), /^chart\.js\/dist\/chart\.js:\d+$/);
	const bar = artifact.definitions.Config_bar;
	const datasets = resolve(resolve(bar.properties.data.node).properties.datasets.node);
	const dataset = resolve(datasets.items);
	assert.deepEqual(dataset.registry, { id: 'chartjs.controllers', prefix: '', enforced: true });
	assert.equal(pointer(dataset), pointer(artifact.root));
	const scale = resolve(resolve(resolve(resolve(bar.properties.options.node).properties.scales.node).values));
	assert.deepEqual(scale.registry, { id: 'chartjs.scales', prefix: '', enforced: true });
	assert.notEqual(pointer(scale), pointer(dataset));
});

test('element options are accepted in every scope the runtime reads them from, citing the resolver', () => {
	const scope = artifact.definitions.ElementOptionsInScope;
	for (const name of [
		'radius',
		'pointRadius',
		'hoverRadius',
		'pointHoverRadius',
		'fill',
		'tension',
		'backgroundColor',
		'arcBorderWidth'
	])
		assert.ok(Object.hasOwn(scope.properties, name), name);
	const pointers = scope.properties.radius.provenance.sources.map(({ pointer }) => pointer);
	assert.ok(pointers.some((pointer) => /^chart\.js\/dist\/chart\.js:\d+$/.test(pointer)));
	const options = resolve(artifact.definitions.Config_line.properties.options.node);
	assert.deepEqual(options.includes, ['ElementOptionsInScope']);
	const dataset = resolve(
		resolve(resolve(artifact.definitions.Config_line.properties.data.node).properties.datasets.node).items
	);
	for (const member of dataset.anyOf)
		assert.deepEqual(artifact.definitions[member.ref].includes, ['ElementOptionsInScope']);
	const animation = resolve(options.properties.animation.node)
		.anyOf.map(resolve)
		.filter((member) => member.kind === 'object');
	assert.ok(animation.length > 0 && animation.every((member) => member.additional === 'open'));
});

test('the global Function type is a function, never an open object (D18)', () => {
	assert.equal(JSON.parse(first.text).definitions.Function, undefined);
});
