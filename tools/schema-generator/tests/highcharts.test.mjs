import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';

import { generate, isRedistributable, LOCAL_ARTIFACTS, run } from '../generate.mjs';
import { verifiedUpstream } from '../lib/lock.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const first = generate(ROOT, 'highcharts');
const artifact = JSON.parse(first.text);
const { definitions } = artifact;
const resolve = (node) => (node.kind === 'ref' ? definitions[node.ref] : node);
const option = resolve(artifact.root);

test('the Highcharts license does not clear redistribution, so the artifact is written only locally', () => {
	const pin = verifiedUpstream(ROOT, 'highcharts');
	assert.equal(isRedistributable(pin), false);
	const where = relative(join(ROOT, LOCAL_ARTIFACTS), first.path);
	assert.equal(where, 'highcharts-13.1.1.json');
	assert.equal(relative(ROOT, first.path).split(sep)[0], 'node_modules');
});

test('generation is deterministic and matches what the build generated in this checkout', () => {
	assert.equal(generate(ROOT, 'highcharts').text, first.text);
	assert.equal(readFileSync(first.path, 'utf8'), first.text);
	assert.deepEqual(run('check', ['highcharts']), []);
});

test('the artifact is well-formed and pinned to the verified upstream package', () => {
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.equal(artifact.libraryVersion, '13.1.1');
	assert.equal(artifact.coverage, 'partial');
	assert.deepEqual(artifact.sources.highcharts, {
		kind: 'npm-package',
		locator: 'highcharts@13.1.1',
		integrity: verifiedUpstream(ROOT, 'highcharts').integrity,
		license: 'LicenseRef-Highsoft'
	});
	assert.equal(first.text.includes(ROOT), false);
});

function provenances(node) {
	if (node === null || typeof node !== 'object') return [];
	const own = node.provenance === undefined ? [] : [node.provenance];
	return [...own, ...Object.values(node).flatMap(provenances)];
}

test('every authoritative fact points into the pinned highcharts package', () => {
	const authoritative = provenances(definitions).filter(({ confidence }) => confidence === 'authoritative');
	assert.ok(authoritative.length > 10_000);
	for (const { sources } of authoritative) {
		assert.equal(sources[0].source, 'highcharts');
		assert.match(sources[0].pointer, /^highcharts\/[\w./-]+\.(d\.ts|src\.js):\d+$/);
	}
});

test('the root is Options with the options of every series type and module', () => {
	assert.equal(option.kind, 'object');
	for (const key of ['chart', 'series', 'xAxis', 'yAxis', 'plotOptions', 'exporting', 'accessibility', 'annotations'])
		assert.ok(Object.hasOwn(option.properties, key), key);
});

test('series are discriminated by type in the runtime series registry; a series without type stays inconclusive', () => {
	const series = resolve(resolve(option.properties.series.node).items);
	assert.equal(series.kind, 'union');
	assert.deepEqual([series.discriminator, series.extensible, series.defaultVariant], ['type', true, undefined]);
	assert.deepEqual(series.registry, { id: 'highcharts.series', prefix: '', enforced: true });
	assert.match(series.provenance.sources[0].pointer, /^highcharts\/highcharts\.src\.js:\d+$/);
	const types = series.anyOf.map((member) => resolve(member).properties.type.node.value);
	assert.equal(new Set(types).size, types.length);
	for (const type of ['line', 'bar', 'pie', 'sankey', 'candlestick', 'map']) assert.ok(types.includes(type), type);
});
