import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';

import { generate, run } from '../generate.mjs';
import { TypeEmitter } from '../lib/emitter.mjs';
import { verifiedUpstream } from '../lib/lock.mjs';
import { createEntryProgram, exportedAliasTypes } from '../lib/program.mjs';

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
		const own = node.kind === 'object' && node.additional === 'open' && Object.keys(node.properties).length === 0 ? 1 : 0;
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
		assert.deepEqual(artifact.definitions[name], { kind: 'object', additional: 'open', properties: {} });
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
	const title = resolve(resolve(options.properties.plugins.node).properties.title.node).anyOf.map(resolve).find((member) => member.kind === 'object');
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
		assert.ok(members.some((member) => member.kind === 'boolean'), id);
	}
});

test('only known homomorphic wrappers pass primitives through; any other alias keeps its object shape', () => {
	const entry = [
		"type Wrap<T> = { v: T };",
		"type Pair<T> = { a: T; b: T };",
		"type Partialish<T> = { [K in keyof T]?: T[K] };",
		"export type U = { w: Wrap<'x'>; p: Pair<number>; q: Partialish<number> };"
	].join('\n');
	const { program, checker, entry: file } = createEntryProgram(ROOT, entry);
	const emit = (wrappers) => {
		const emitter = new TypeEmitter({ program, checker, sourceId: 't', packageName: 'test', wrappers });
		const node = emitter.emit(exportedAliasTypes(checker, file).get('U'));
		return { node, definitions: emitter.definitions };
	};
	const strict = emit(new Set());
	const shape = (name) => strict.definitions[strict.definitions.U.properties[name].node.ref];
	assert.equal(shape('w').kind, 'object');
	assert.deepEqual(Object.keys(shape('w').properties), ['v']);
	assert.deepEqual(Object.keys(shape('p').properties), ['a', 'b']);
	const lenient = emit(new Set(['Partialish']));
	assert.deepEqual(lenient.definitions.U.properties.q.node, { kind: 'number' });
	assert.equal(lenient.definitions.U.properties.w.node.kind, 'ref');
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

function fakeRoot(t, { installed = '4.5.1', integrity } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'schema-lock-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'tools/schema-generator'), { recursive: true });
	mkdirSync(join(root, 'node_modules/chart.js'), { recursive: true });
	cpSync(join(ROOT, 'tools/schema-generator/upstream-sources.json'), join(root, 'tools/schema-generator/upstream-sources.json'));
	writeFileSync(join(root, 'node_modules/chart.js/package.json'), JSON.stringify({ version: installed }));
	const pin = verifiedUpstream(ROOT, 'chartjs');
	const lock = { packages: { 'node_modules/chart.js': { version: installed, integrity: integrity ?? pin.integrity } } };
	writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
	return root;
}

test('generation refuses an installed package that differs from the pin', (t) => {
	assert.throws(() => verifiedUpstream(fakeRoot(t, { installed: '4.5.0' }), 'chartjs'), /installed 4\.5\.0, pinned 4\.5\.1/);
	assert.throws(() => verifiedUpstream(fakeRoot(t, { integrity: 'sha512-other' }), 'chartjs'), /integrity differs/);
	assert.throws(() => verifiedUpstream(fakeRoot(t), 'd3'), /No upstream pin for d3/);
});

test('element options are accepted in every scope the runtime reads them from, citing the resolver', () => {
	const scope = artifact.definitions.ElementOptionsInScope;
	for (const name of ['radius', 'pointRadius', 'hoverRadius', 'pointHoverRadius', 'fill', 'tension', 'backgroundColor', 'arcBorderWidth'])
		assert.ok(Object.hasOwn(scope.properties, name), name);
	const pointers = scope.properties.radius.provenance.sources.map(({ pointer }) => pointer);
	assert.ok(pointers.some((pointer) => /^chart\.js\/dist\/chart\.js:\d+$/.test(pointer)));
	const options = resolve(artifact.definitions.Config_line.properties.options.node);
	assert.deepEqual(options.includes, ['ElementOptionsInScope']);
	const dataset = resolve(resolve(resolve(artifact.definitions.Config_line.properties.data.node).properties.datasets.node).items);
	for (const member of dataset.anyOf) assert.deepEqual(artifact.definitions[member.ref].includes, ['ElementOptionsInScope']);
	const animation = resolve(options.properties.animation.node).anyOf.map(resolve).filter((member) => member.kind === 'object');
	assert.ok(animation.length > 0 && animation.every((member) => member.additional === 'open'));
});
