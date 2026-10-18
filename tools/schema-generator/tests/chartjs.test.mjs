import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';

import { generate } from '../generate.mjs';
import { verifiedUpstream } from '../lib/lock.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const first = generate(ROOT, 'chartjs');
const artifact = JSON.parse(first.text);

test('generation is deterministic and matches the committed artifact', () => {
	assert.equal(generate(ROOT, 'chartjs').text, first.text);
	assert.equal(readFileSync(first.path, 'utf8'), first.text);
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

function provenances(node) {
	if (node === null || typeof node !== 'object') return [];
	const own = node.provenance === undefined ? [] : [node.provenance];
	return [...own, ...Object.values(node).flatMap(provenances)];
}

test('every fact traces to a declaration inside the chart.js package', () => {
	const all = provenances(artifact.definitions);
	assert.ok(all.length > 1000);
	assert.ok(all.every(({ confidence, sources }) => confidence === 'authoritative' && sources[0].source === 'chartjs'));
	const outside = all.map(({ sources }) => sources[0].pointer).filter((pointer) => pointer !== undefined && !pointer.startsWith('chart.js/'));
	assert.deepEqual(outside, []);
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
