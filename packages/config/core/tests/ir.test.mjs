import assert from 'node:assert/strict';
import test from 'node:test';

import { lowerArtifact, manifestFromArtifact, validateConfig } from '../dist/index.js';
import { artifact, closedRoot, problems, prop, typed } from './fixtures.mjs';

test('a well-formed artifact has no problems and lowers to a full manifest', () => {
	assert.deepEqual(problems(artifact(closedRoot)), []);
	const { manifest, lossy } = lowerArtifact(artifact(closedRoot));
	assert.deepEqual(lossy, []);
	assert.equal(manifest.coverage, 'full');
	assert.equal(manifest.version, '1.2.3');
	assert.equal(validateConfig({ type: 'bar', height: 3 }, manifest).status, 'valid');
});

test('unknown keys in closed authoritative objects are confirmed errors', () => {
	const result = validateConfig({ type: 'bar', heigt: 3 }, manifestFromArtifact(artifact(closedRoot)));
	assert.equal(result.status, 'invalid');
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.severity, d.suggestion]),
		[['CFG_UNKNOWN_KEY', 'error', 'Did you mean "height"?']]
	);
});

test('literal unions become enums; required properties stay required', () => {
	const manifest = manifestFromArtifact(artifact(closedRoot));
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ type: 'pie' }), ['CFG_ENUM $.type']);
	assert.deepEqual(codes({}), ['CFG_REQUIRED $.type']);
});

test('closed objects without authoritative provenance only warn', () => {
	const root = { ...closedRoot, provenance: { confidence: 'derived', sources: [{ source: 'docs' }] } };
	const result = validateConfig({ type: 'bar', extra: 1 }, manifestFromArtifact(artifact(root)));
	assert.equal(result.valid, true);
	assert.equal(result.diagnostics[0].severity, 'warning');
});

test('unions, scriptables, records, null and open objects lower exactly; only recursion stays lossy', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: {
			size: prop({ kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'string' }, { kind: 'null' }] }),
			color: prop({ kind: 'scriptable', value: { kind: 'string' } }),
			plugins: prop({ kind: 'object', additional: 'open', properties: {} }),
			scales: prop({
				kind: 'record',
				values: { kind: 'object', additional: 'unknown', properties: { min: prop({ kind: 'number' }) } }
			}),
			tree: prop({ kind: 'ref', ref: 'Tree' })
		}
	};
	const definitions = {
		Tree: { kind: 'object', additional: 'unknown', properties: { child: prop({ kind: 'ref', ref: 'Tree' }) } }
	};
	const { manifest, lossy } = lowerArtifact(artifact(root, { definitions }));
	assert.deepEqual(lossy, ['$.tree.child']);
	assert.equal(manifest.coverage, 'partial');
	const config = {
		size: '50%',
		color: () => 'red',
		plugins: { anything: true },
		scales: { y1: {} },
		tree: { child: {} }
	};
	const result = validateConfig(config, manifest);
	assert.equal(result.valid, true);
	assert.equal(result.status, 'partial');
	assert.deepEqual(result.diagnostics, []);
	const wrong = validateConfig({ size: true, color: 1, scales: { y1: { min: 'x' } } }, manifest);
	assert.deepEqual(
		wrong.diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_TYPE $.size', 'CFG_TYPE $.color', 'CFG_TYPE $.scales.y1.min']
	);
});

test('discriminated unions keep their default variant and extensibility', () => {
	const variant = (value) => ({
		kind: 'object',
		additional: 'unknown',
		properties: { type: prop({ kind: 'literal', value }), width: prop({ kind: 'number' }) }
	});
	const root = {
		kind: 'union',
		anyOf: [variant('bar'), variant('line')],
		discriminator: 'type',
		defaultVariant: 0,
		extensible: true
	};
	assert.deepEqual(problems(artifact(root)), []);
	const manifest = manifestFromArtifact(artifact(root));
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ width: 'x' }), ['CFG_TYPE $.width']);
	assert.deepEqual(codes({ type: 'treemap' }), ['CFG_UNKNOWN_VARIANT $.type']);
	assert.deepEqual(problems(artifact({ ...root, defaultVariant: 2, extensible: 'yes', discriminator: 1 })), [
		'$.root: defaultVariant must index anyOf',
		'$.root: extensible must be a boolean',
		'$.root: discriminator must be a string'
	]);
});

test('every primitive kind and arrays lower to exact engine checks', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: {
			label: prop({ kind: 'string' }),
			show: prop({ kind: 'boolean' }),
			format: prop({ kind: 'function' }),
			ticks: prop({ kind: 'array', items: { kind: 'number' } }),
			level: prop({
				kind: 'union',
				anyOf: [
					{ kind: 'literal', value: 1 },
					{ kind: 'literal', value: 2 }
				]
			}),
			flag: prop({ kind: 'literal', value: true })
		}
	};
	const { manifest, lossy } = lowerArtifact(artifact(root));
	assert.deepEqual(lossy, []);
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ label: 'a', show: true, format: () => '', ticks: [1, 2], level: 2, flag: true }), []);
	assert.deepEqual(codes({ label: 1, show: 'yes', format: 'x', ticks: [1, 'b'], level: 3, flag: false }), [
		'CFG_TYPE $.label',
		'CFG_TYPE $.show',
		'CFG_TYPE $.format',
		'CFG_TYPE $.ticks[1]',
		'CFG_ENUM $.level',
		'CFG_ENUM $.flag'
	]);
});

test('null literals and mixed literal unions lower to exact unions', () => {
	const root = {
		kind: 'union',
		anyOf: [
			{ kind: 'literal', value: null },
			{ kind: 'literal', value: 'auto' }
		]
	};
	const { manifest, lossy } = lowerArtifact(artifact(root));
	assert.deepEqual(lossy, []);
	assert.equal(validateConfig(null, manifest).valid, true);
	assert.equal(validateConfig('auto', manifest).valid, true);
	assert.equal(validateConfig('x', manifest).diagnostics[0].code, 'CFG_ENUM');
});

test('a scriptable whose value is a union accepts every member and a function', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: {
			color: prop({ kind: 'scriptable', value: { kind: 'union', anyOf: [{ kind: 'string' }, { kind: 'number' }] } })
		}
	};
	const { manifest, lossy } = lowerArtifact(artifact(root));
	assert.deepEqual(lossy, []);
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ color: 'red' }), []);
	assert.deepEqual(codes({ color: 3 }), []);
	assert.deepEqual(codes({ color: () => 'red' }), []);
	assert.deepEqual(codes({ color: true }), ['CFG_TYPE $.color']);
});

test('an artifact with only open extension points and no unknowns lowers to full coverage', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: { plugins: prop({ kind: 'object', additional: 'open', properties: {} }) }
	};
	const { manifest, lossy } = lowerArtifact(artifact(root));
	assert.deepEqual(lossy, []);
	assert.equal(manifest.coverage, 'full');
	assert.equal(validateConfig({ plugins: { anything: { nested: true } } }, manifest).status, 'valid');
});

test('included definitions add their properties; own properties win', () => {
	const shared = {
		kind: 'object',
		additional: 'unknown',
		properties: { radius: prop({ kind: 'number' }), label: prop({ kind: 'number' }) }
	};
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: { label: prop({ kind: 'string' }) },
		includes: ['Shared']
	};
	const { manifest, lossy } = lowerArtifact(artifact(root, { definitions: { Shared: shared } }));
	assert.deepEqual(lossy, []);
	const codes = (config) => validateConfig(config, manifest).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes({ radius: 2, label: 'a' }), []);
	assert.deepEqual(codes({ radius: 'x', label: 1 }), ['CFG_TYPE $.radius', 'CFG_TYPE $.label']);
	assert.deepEqual(codes({ radios: 1 }), ['CFG_UNKNOWN_KEY $.radios']);
});
