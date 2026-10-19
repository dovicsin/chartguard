import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';

import { generate, run } from '../generate.mjs';
import { verifiedUpstream } from '../lib/lock.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const first = generate(ROOT, 'echarts');
const artifact = JSON.parse(first.text);
const { definitions } = artifact;
const resolve = (node) => (node.kind === 'ref' ? definitions[node.ref] : node);
const option = resolve(artifact.root);

test('generation is deterministic and matches the committed artifact', () => {
	assert.equal(generate(ROOT, 'echarts').text, first.text);
	assert.equal(readFileSync(first.path, 'utf8'), first.text);
	assert.deepEqual(run('check', ['echarts']), []);
});

test('the artifact is well-formed and pinned to the verified upstream package', () => {
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.equal(artifact.libraryVersion, '6.1.0');
	assert.equal(artifact.coverage, 'partial');
	assert.deepEqual(artifact.sources.echarts, {
		kind: 'npm-package',
		locator: 'echarts@6.1.0',
		integrity: verifiedUpstream(ROOT, 'echarts').integrity,
		license: 'Apache-2.0'
	});
});

function provenances(node) {
	if (node === null || typeof node !== 'object') return [];
	const own = node.provenance === undefined ? [] : [node.provenance];
	return [...own, ...Object.values(node).flatMap(provenances)];
}

test('every fact is authoritative and points into the pinned echarts package (declarations or runtime)', () => {
	const all = provenances(definitions);
	assert.ok(all.length > 5000);
	for (const { confidence, sources } of all) {
		assert.equal(confidence, 'authoritative');
		assert.equal(sources[0].source, 'echarts');
		assert.match(sources[0].pointer, /^echarts\/(types\/dist\/shared\.d\.ts|lib\/[\w/-]+\.js):\d+$/);
	}
	assert.equal(first.text.includes(ROOT), false);
});

test('the root is EChartsOption: an open object, because extensions register root components', () => {
	assert.equal(option.kind, 'object');
	assert.equal(option.additional, 'open');
	for (const key of ['series', 'xAxis', 'yAxis', 'dataset', 'tooltip', 'baseOption', 'options', 'media'])
		assert.ok(Object.hasOwn(option.properties, key), key);
});

test('series is one object or a list, discriminated by type and extensible at both levels', () => {
	const series = resolve(option.properties.series.node);
	assert.deepEqual([series.discriminator, series.extensible], ['type', true]);
	const list = series.anyOf.find((member) => member.kind === 'array');
	const element = resolve(list.items);
	assert.deepEqual([element.discriminator, element.extensible], ['type', true]);
	const types = element.anyOf.map((member) => resolve(member).properties.type.node.value);
	for (const builtIn of ['line', 'bar', 'pie', 'scatter', 'custom', 'lines', 'tree', 'chord']) assert.ok(types.includes(builtIn));
});

test('numeric axes accept a boolean boundaryGap, as parseBoundaryGapOption does at runtime', () => {
	const xAxis = resolve(option.properties.xAxis.node);
	const value = xAxis.anyOf.map(resolve).find((member) => member.properties?.type?.node.value === 'value');
	const boundaryGap = value.properties.boundaryGap.node;
	assert.equal(boundaryGap.kind, 'union');
	assert.deepEqual(boundaryGap.anyOf.at(-1), { kind: 'boolean' });
});

test('large unions are stored once and referenced instead of copied under every property', () => {
	const counts = new Map();
	const visit = (node) => {
		if (node === null || typeof node !== 'object') return;
		if (node.kind === 'union') {
			const text = JSON.stringify(node);
			if (text.length > 300) counts.set(text, (counts.get(text) ?? 0) + 1);
		}
		for (const child of Object.values(node)) visit(child);
	};
	for (const definition of Object.values(definitions)) for (const child of Object.values(definition)) visit(child);
	assert.deepEqual(
		[...counts.values()].filter((count) => count > 1),
		[]
	);
});

test('component subtypes and axis defaults come from the runtime, each citing the line it is read from', () => {
	const dataZoom = resolve(option.properties.dataZoom.node);
	assert.deepEqual([dataZoom.discriminator, dataZoom.extensible], ['type', true]);
	assert.equal(resolve(dataZoom.anyOf[dataZoom.defaultVariant]).properties.type.node.value, 'slider');
	assert.match(dataZoom.provenance.sources[0].pointer, /^echarts\/lib\/component\/dataZoom\/installCommon\.js:\d+$/);
	const slider = resolve(dataZoom.anyOf[dataZoom.defaultVariant]).properties.type;
	assert.match(slider.provenance.sources[0].pointer, /^echarts\/lib\/component\/dataZoom\/SliderZoomModel\.js:\d+$/);
	const legend = resolve(option.properties.legend.node);
	assert.equal(resolve(legend.anyOf[legend.defaultVariant]).properties.type.node.value, 'plain');
	for (const axis of ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis', 'parallelAxis']) {
		const union = resolve(option.properties[axis].node);
		const [rule] = union.defaultWhen;
		assert.equal(resolve(union.anyOf[rule.variant]).properties.type.node.value, 'category', axis);
		assert.equal(resolve(union.anyOf[union.defaultVariant]).properties.type.node.value, 'value', axis);
		assert.match(union.provenance.sources[0].pointer, /^echarts\/lib\/coord\/axisModelCreator\.js:\d+$/);
	}
	assert.equal(resolve(option.properties.visualMap.node).discriminator, undefined);
});
