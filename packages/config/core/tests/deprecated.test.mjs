import assert from 'node:assert/strict';
import test from 'node:test';

import { manifestFromArtifact, validateConfig } from '../dist/index.js';
import { artifact, problems, prop } from './fixtures.mjs';

/** A series whose `clipOverflow` the runtime copies into `clip`, and whose `margin` its docs deprecate. */
function root() {
	return {
		kind: 'object',
		additional: 'closed',
		properties: {
			clip: prop({ kind: 'boolean' }),
			clipOverflow: {
				...prop({ kind: 'boolean' }),
				deprecated: { message: 'clipOverflow is deprecated; use clip instead.', replacement: 'clip', renameTo: 'clip' }
			},
			margin: {
				...prop({ kind: 'number' }),
				deprecated: { message: 'Use `edgeDistance` instead', replacement: 'edgeDistance' }
			},
			edgeDistance: prop({ kind: 'number' })
		}
	};
}
const manifest = manifestFromArtifact(artifact(root()));
const report = (config) => validateConfig(config, manifest).diagnostics;

test('a deprecated option is a certain warning naming its replacement, and its value is still checked', () => {
	const [deprecated, type] = report({ clipOverflow: 'yes' });
	assert.deepEqual(
		[
			deprecated.code,
			deprecated.severity,
			deprecated.confidence,
			deprecated.path,
			deprecated.message,
			deprecated.suggestion
		],
		[
			'CFG_DEPRECATED',
			'warning',
			'certain',
			'$.clipOverflow',
			'Deprecated: clipOverflow is deprecated; use clip instead.',
			'Use "clip" instead.'
		]
	);
	assert.deepEqual([type.code, type.path], ['CFG_TYPE', '$.clipOverflow']);
	assert.equal(validateConfig({ clipOverflow: true }, manifest).valid, true);
});

test('a rename the runtime itself performs is offered as a safe fix, unless the new key is already set', () => {
	assert.deepEqual(report({ clipOverflow: true })[0].fix, { kind: 'rename-key', to: 'clip' });
	// With both set, renaming would drop one value: the runtime decides which wins, so no fix.
	assert.equal(report({ clipOverflow: true, clip: false })[0].fix, undefined);
	assert.equal(report({ clipOverflow: true, clip: undefined })[0].fix?.to, 'clip');
	// The runtime copies only `!= null` values: renaming a null would hand `clip` a value it never had.
	assert.equal(report({ clipOverflow: null })[0].fix, undefined);
	const getter = Object.defineProperty({ clipOverflow: true }, 'clip', { enumerable: true, get: () => false });
	assert.equal(validateConfig(getter, manifest).diagnostics.find((d) => d.code === 'CFG_DEPRECATED').fix, undefined);
});

test('a deprecation the docs state is reported without a fix: a rename may change what the runtime draws', () => {
	const [finding] = report({ margin: 4 });
	assert.deepEqual(
		[finding.code, finding.suggestion, finding.fix],
		['CFG_DEPRECATED', 'Use "edgeDistance" instead.', undefined]
	);
});

test('an absent or undefined deprecated option is not reported', () => {
	assert.deepEqual(report({ clip: true }), []);
	assert.deepEqual(report({ clipOverflow: undefined }), []);
});

test('a deprecation must be an object of strings, and a rename target must be a sibling the object declares', () => {
	const broken = (deprecated) => {
		const node = root();
		node.properties.margin = { ...node.properties.margin, deprecated };
		return problems(artifact(node));
	};
	assert.deepEqual(broken({ message: 'x', since: '5.0.0' }), []);
	for (const bad of ['x', { message: 1 }, { replacement: ['a'] }])
		assert.deepEqual(broken(bad), [
			'$.root.properties.margin: deprecated must be { since?, replacement?, message?, renameTo? } of strings'
		]);
	assert.deepEqual(broken({ renameTo: 'nope' }), [
		'$.root.properties.margin: deprecated renameTo "nope" is not a sibling property'
	]);
});
