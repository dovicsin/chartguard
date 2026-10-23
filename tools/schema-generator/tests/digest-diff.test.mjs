import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkArtifact } from '@chartguard/config-core';
import { digestOf, omit, serialize, withDigest } from '@chartguard/schema-generator';
import { verifiedUpstream } from '@chartguard/schema-generator';

import { artifactPath, LIBRARIES } from '../generate.mjs';
import { canonicalPaths, diffArtifacts, formatDiff } from '../lib/diff.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The artifact on disk: committed, or generated locally by the build (Highcharts). */
const committed = (library) => readFileSync(artifactPath(ROOT, verifiedUpstream(ROOT, library), library), 'utf8');

test('every committed artifact carries the digest of its own content', () => {
	for (const library of LIBRARIES) {
		const artifact = JSON.parse(committed(library));
		assert.match(artifact.digest, /^sha256-[0-9a-f]{64}$/);
		assert.equal(digestOf(artifact), artifact.digest);
		assert.equal(Object.keys(artifact).indexOf('digest'), Object.keys(artifact).indexOf('generator') + 1);
		assert.equal(digestOf({ ...artifact, coverage: 'full' }) === artifact.digest, false);
	}
});

test('a digest is checked for its format', () => {
	const artifact = JSON.parse(committed('chartjs'));
	assert.deepEqual(checkArtifact(artifact).problems, []);
	assert.deepEqual(checkArtifact({ ...artifact, digest: 'md5-abc' }).problems, [
		'$.digest: expected sha256-<64 hex digits>, got "md5-abc"'
	]);
	assert.deepEqual(checkArtifact(omit(artifact, ['digest'])).problems, []);
});

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('generation is byte-identical across separate processes', () => {
	const script = `import { createHash } from 'node:crypto';
		import { generate } from './tools/schema-generator/generate.mjs';
		const hashes = process.argv.slice(1).map((library) =>
			createHash('sha256').update(generate(process.cwd(), library).text).digest('hex'));
		process.stdout.write(JSON.stringify(hashes));`;
	const run = () => {
		const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, ...LIBRARIES], {
			cwd: ROOT,
			encoding: 'utf8'
		});
		assert.equal(child.status, 0, child.stderr);
		return JSON.parse(child.stdout);
	};
	const first = run();
	assert.deepEqual(
		first,
		LIBRARIES.map((library) => sha256(committed(library)))
	);
	assert.deepEqual(run(), first);
});

const prop = (node, extra = {}) => ({ node, provenance: { confidence: 'manual', sources: [] }, ...extra });
const object = (properties, additional = 'closed') => ({ kind: 'object', additional, properties });

function sample(names = { Options: 'Options', Line: 'Line', Bar: 'Bar' }) {
	return withDigest({
		irVersion: 1,
		library: 'demo',
		libraryVersion: '1.0.0',
		coverage: 'partial',
		generator: { name: 'test', version: '0' },
		sources: {},
		definitions: {
			[names.Options]: object({ width: prop({ kind: 'number' }), title: prop({ kind: 'string' }, { required: true }) }),
			[names.Line]: object({
				type: prop({ kind: 'literal', value: 'line' }),
				options: prop({ kind: 'ref', ref: names.Options })
			}),
			[names.Bar]: object({ type: prop({ kind: 'literal', value: 'bar' }) })
		},
		root: {
			kind: 'union',
			discriminator: 'type',
			anyOf: [
				{ kind: 'ref', ref: names.Line },
				{ kind: 'ref', ref: names.Bar }
			]
		}
	});
}

test('definitions are identified by canonical paths labelled with discriminator values', () => {
	assert.deepEqual(
		[...canonicalPaths(sample()).entries()],
		[
			['Line', '$<type=line>'],
			['Bar', '$<type=bar>'],
			['Options', '$<type=line>.options']
		]
	);
});

test('renaming definitions only is not a change; a self-diff of every real artifact is empty', () => {
	const renamed = sample({ Options: 'X1', Line: 'X2', Bar: 'X3' });
	assert.deepEqual(diffArtifacts(sample(), renamed), []);
	for (const library of LIBRARIES) {
		const artifact = JSON.parse(committed(library));
		assert.deepEqual(diffArtifacts(artifact, artifact), []);
	}
});

test('every change kind is reported once, at its canonical path', () => {
	const before = sample();
	const after = structuredClone(before);
	const options = after.definitions.Options;
	delete options.properties.width;
	options.properties.height = prop({ kind: 'number' });
	options.properties.title = prop({ kind: 'scriptable', value: { kind: 'string' } });
	options.additional = 'open';
	options.nullAsAbsent = true;
	after.definitions.Bar.properties.type.required = true;
	after.definitions.Bar.properties.type.handledBy = { id: 'demo', name: 'bar', enforced: true };
	after.definitions.Bar.properties.type.deprecated = { since: '1.0.0' };
	after.root.extensible = true;
	assert.deepEqual(
		diffArtifacts(before, after).map(({ kind, path }) => `${kind} ${path}`),
		[
			'extensible-changed $',
			'deprecated-changed $<type=bar>.type',
			'handledBy-changed $<type=bar>.type',
			'required-changed $<type=bar>.type',
			'nullAsAbsent-changed $<type=line>.options',
			'openness-changed $<type=line>.options',
			'property-added $<type=line>.options.height',
			'property-changed $<type=line>.options.title',
			'required-changed $<type=line>.options.title',
			'property-removed $<type=line>.options.width'
		]
	);
});

test('added and removed definitions, and a definition that changes kind, are reported', () => {
	const before = sample();
	const after = structuredClone(before);
	after.definitions.Pie = object({ type: prop({ kind: 'literal', value: 'pie' }) });
	after.root.anyOf.push({ kind: 'ref', ref: 'Pie' });
	after.definitions.Options = { kind: 'record', values: { kind: 'number' } };
	const changes = diffArtifacts(before, after);
	assert.deepEqual(
		changes.map(({ kind, path }) => `${kind} ${path}`),
		['definition-changed $', 'definition-changed $<type=line>.options', 'definition-added $<type=pie>']
	);
	const lines = formatDiff(changes);
	assert.match(lines[1], /^~ \$<type=line>\.options \(definition-changed\): .* -> /);
	assert.match(lines[2], /^\+ \$<type=pie> \(definition-added\): /);
	assert.deepEqual(
		formatDiff(diffArtifacts(after, before)).map((line) => line.slice(0, 2)),
		['~ ', '~ ', '- ']
	);
});

test('the committed artifact text is what serialize produces', () => {
	for (const library of LIBRARIES) assert.equal(serialize(JSON.parse(committed(library))), committed(library));
});

test('an included definition gets a path only when nothing else reaches it, and changes to includes are reported', () => {
	const before = sample();
	const after = structuredClone(before);
	after.definitions.Shared = object({ radius: prop({ kind: 'number' }) });
	after.definitions.Options.includes = ['Shared'];
	assert.equal(canonicalPaths(after).get('Shared'), '$<type=line>.options<includes>');
	assert.equal(canonicalPaths(after).get('Options'), canonicalPaths(before).get('Options'));
	assert.deepEqual(
		diffArtifacts(before, after).map(({ kind, path }) => `${kind} ${path}`),
		['includes-changed $<type=line>.options', 'definition-added $<type=line>.options<includes>']
	);
});

test('option names are data, never IR fields: options named includes, provenance, docs or kind are diffed like any other (D17)', () => {
	const before = sample();
	for (const name of ['includes', 'provenance', 'docs', 'kind', 'ref'])
		before.definitions.Options.properties[name] = prop({ kind: 'number' });
	const after = structuredClone(before);
	for (const name of ['includes', 'provenance', 'docs', 'kind', 'ref'])
		after.definitions.Options.properties[name] = prop({ kind: 'string' });
	assert.deepEqual(diffArtifacts(before, before), []);
	assert.deepEqual(
		diffArtifacts(before, after).map(({ kind, path }) => `${kind} ${path}`),
		['docs', 'includes', 'kind', 'provenance', 'ref'].map((name) => `property-changed $<type=line>.options.${name}`)
	);
});
