import assert from 'node:assert/strict';
import test from 'node:test';

import { checkArtifact, lowerArtifact, manifestFromArtifact, validateConfig } from '../dist/index.js';

const NPM = { kind: 'npm-package', locator: 'demo@1.2.3', integrity: 'sha512-abc', license: 'MIT' };
const DOCS = { kind: 'docs-tree', locator: 'https://example.test/tree.json', license: 'MIT', retrieved: '2026-10-17' };
const typed = (pointer) => ({ confidence: 'authoritative', sources: [{ source: 'npm', pointer }] });
const prop = (node, extra = {}) => ({ node, provenance: typed('Options'), ...extra });

function artifact(root, overrides = {}) {
	return {
		irVersion: 1,
		library: 'demo',
		libraryVersion: '1.2.3',
		coverage: 'full',
		generator: { name: 'test', version: '0.0.0' },
		sources: { npm: NPM, docs: DOCS },
		definitions: {},
		root,
		...overrides
	};
}

const closedRoot = {
	kind: 'object',
	additional: 'closed',
	provenance: typed('Options'),
	properties: {
		type: prop(
			{
				kind: 'union',
				anyOf: [
					{ kind: 'literal', value: 'bar' },
					{ kind: 'literal', value: 'line' }
				]
			},
			{ required: true }
		),
		height: prop({ kind: 'number' })
	}
};

const problems = (value) => checkArtifact(value).problems;

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

test('constructs the engine cannot check exactly are open, lossy and partial', () => {
	const root = {
		kind: 'object',
		additional: 'closed',
		provenance: typed('Options'),
		properties: {
			size: prop({ kind: 'union', anyOf: [{ kind: 'number' }, { kind: 'string' }, { kind: 'null' }] }),
			color: prop({ kind: 'scriptable', value: { kind: 'string' } }),
			plugins: prop({ kind: 'object', additional: 'open', properties: {} }),
			scales: prop({ kind: 'record', values: { kind: 'object', additional: 'unknown', properties: {} } }),
			tree: prop({ kind: 'ref', ref: 'Tree' })
		}
	};
	const definitions = {
		Tree: { kind: 'object', additional: 'unknown', properties: { child: prop({ kind: 'ref', ref: 'Tree' }) } }
	};
	const { manifest, lossy } = lowerArtifact(artifact(root, { definitions }));
	assert.deepEqual(lossy, ['$.size', '$.color', '$.plugins', '$.scales', '$.tree.child']);
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
});

test('malformed artifacts report every problem with its path', () => {
	assert.deepEqual(problems(artifact(closedRoot, { irVersion: 2 })), ['$.irVersion: expected 1']);
	assert.deepEqual(problems(artifact(closedRoot, { libraryVersion: '4.x' })), [
		'$.libraryVersion: expected an exact version, got "4.x"'
	]);
	assert.deepEqual(problems(artifact({ kind: 'ref', ref: 'Missing' })), ['$.root: unresolved ref "Missing"']);
	assert.deepEqual(problems(artifact({ kind: 'tuple' })), ['$.root: unknown node kind "tuple"']);
	assert.deepEqual(problems('nope'), ['$: expected an object']);
});

test('provenance must trace to recorded, pinned sources', () => {
	const withProvenance = (provenance) =>
		artifact({ kind: 'object', additional: 'closed', properties: { a: { node: { kind: 'number' }, provenance } } });
	assert.deepEqual(problems(withProvenance({ confidence: 'authoritative', sources: [] })), [
		'$.root.properties.a.provenance: authoritative provenance needs at least one source'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'authoritative', sources: [{ source: 'docs' }] })), [
		'$.root.properties.a.provenance: authoritative source "docs" has no integrity pin'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'derived', sources: [{ source: 'ghost' }] })), [
		'$.root.properties.a.provenance: unknown source "ghost"'
	]);
	assert.deepEqual(problems(withProvenance({ confidence: 'sure' })), [
		'$.root.properties.a.provenance: unknown confidence "sure"'
	]);
	assert.deepEqual(
		problems(artifact({ kind: 'object', additional: 'closed', properties: { a: { node: { kind: 'number' } } } })),
		['$.root.properties.a.provenance: expected an object']
	);
});

test('excessively deep artifacts are rejected instead of overflowing the stack', () => {
	let root = { kind: 'number' };
	for (let depth = 0; depth < 300; depth++) root = { kind: 'array', items: root };
	assert.match(problems(artifact(root)).join('\n'), /maximum depth/);
});

test('loading a malformed artifact throws one error listing all problems', () =>
	assert.throws(() => manifestFromArtifact(artifact({ kind: 'ref', ref: 'Missing' }, { coverage: 'most' })), {
		message: 'Invalid schema artifact:\n$.coverage: expected "partial" or "full"\n$.root: unresolved ref "Missing"'
	}));

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

test('null literals and mixed literal unions are not guessed', () => {
	const root = {
		kind: 'union',
		anyOf: [
			{ kind: 'literal', value: null },
			{ kind: 'literal', value: 'auto' }
		]
	};
	assert.deepEqual(lowerArtifact(artifact(root)).lossy, ['$']);
	assert.deepEqual(lowerArtifact(artifact({ kind: 'literal', value: null })).lossy, ['$']);
});

test('header, source and node shape problems are all reported', () => {
	const broken = {
		...artifact({ kind: 'union', anyOf: [] }),
		library: '',
		generator: { name: 'x' },
		sources: { bad: { kind: 'ftp', integrity: 1 }, worse: 'x' },
		definitions: {
			A: { kind: 'object', additional: 'maybe', properties: { p: 'x' } },
			B: { kind: 'object', additional: 'open', properties: 'x' },
			C: { kind: 'literal', value: {} },
			D: { kind: 'record', values: { kind: 'scriptable', value: 'x' } }
		}
	};
	assert.deepEqual(problems(broken), [
		'$.library: expected a non-empty string',
		'$.generator: expected { name, version } strings',
		'$.sources.bad: unknown source kind "ftp"',
		'$.sources.bad: expected a locator string',
		'$.sources.bad: expected a license string',
		'$.sources.bad: integrity and retrieved must be strings when present',
		'$.sources.worse: expected an object',
		'$.definitions.A.properties.p: expected an object',
		'$.definitions.A: expected additional to be "closed", "open" or "unknown"',
		'$.definitions.B.properties: expected an object',
		'$.definitions.C: expected a primitive literal value',
		'$.definitions.D.values.value: expected an object',
		'$.root: expected a non-empty anyOf array'
	]);
	assert.deepEqual(problems({ ...artifact(closedRoot), sources: [], definitions: 'x' }), [
		'$.definitions: expected an object',
		'$.sources: expected an object',
		'$.root.provenance: unknown source "npm"',
		'$.root.properties.type.provenance: unknown source "npm"',
		'$.root.properties.height.provenance: unknown source "npm"'
	]);
});

test('provenance sources must be a list of known references', () => {
	const root = (provenance) => artifact({ kind: 'number', provenance });
	assert.deepEqual(problems(root({ confidence: 'manual', sources: 'npm' })), [
		'$.root.provenance: expected sources to be an array'
	]);
	assert.deepEqual(problems(root({ confidence: 'manual', sources: [{ source: 7 }] })), [
		'$.root.provenance: unknown source number'
	]);
	assert.deepEqual(problems(root({ confidence: 'manual', sources: ['npm'] })), [
		'$.root.provenance: expected { source } references'
	]);
});
