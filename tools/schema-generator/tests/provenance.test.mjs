import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compilerPin, untracedFacts, UpstreamError, verifiedCompiler } from '@chartguard/schema-generator';
import ts from 'typescript';

import { generate } from '../generate.mjs';

/**
 * CG-07-06: an artifact names everything it is built from (the library, the compiler that read it,
 * the generator), and each of its facts traces to the line of the source it cites.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const GENERATOR = join(ROOT, 'packages', 'schema-generator');
const manifest = JSON.parse(readFileSync(join(GENERATOR, 'package.json'), 'utf8'));
const committed = Object.fromEntries(
	['chartjs', 'echarts'].map((library) => [library, JSON.parse(generate(ROOT, library).text)])
);
const highcharts = JSON.parse(generate(ROOT, 'highcharts').text);
const artifacts = { ...committed, highcharts };

/** The line (1-based) of the first line of `file` in the pinned install that includes `text`. */
function lineOf(file, text) {
	const index = readFileSync(join(ROOT, 'node_modules', file), 'utf8')
		.split('\n')
		.findIndex((line) => line.includes(text));
	assert.notEqual(index, -1, `${text} in ${file}`);
	return index + 1;
}

/** A minimal artifact with one object whose property `name` cites `pointer`. */
const citing = (name, pointer, { source = 'chartjs', confidence = 'authoritative' } = {}) => ({
	sources: {
		chartjs: { kind: 'npm-package', locator: 'chart.js@4.6.1' },
		typescript: { kind: 'npm-package', locator: 'typescript@5.9.3' }
	},
	definitions: {
		Options: {
			kind: 'object',
			properties: { [name]: { node: { kind: 'number' }, provenance: { confidence, sources: [{ source, pointer }] } } }
		}
	},
	root: { kind: 'ref', ref: 'Options' }
});

test('every artifact names the library, the compiler and the generator it was built from', () => {
	const compiler = compilerPin();
	for (const [library, artifact] of Object.entries(artifacts)) {
		assert.deepEqual(artifact.generator, { name: manifest.name, version: manifest.version }, library);
		assert.deepEqual(
			artifact.sources.typescript,
			{
				kind: 'npm-package',
				locator: `typescript@${compiler.version}`,
				integrity: compiler.integrity,
				license: compiler.license.spdx
			},
			library
		);
	}
});

test('the generator builds only with the pinned compiler, which npm installs exactly', () => {
	const compiler = compilerPin();
	assert.equal(ts.version, compiler.version);
	assert.equal(manifest.dependencies.typescript, compiler.version);
	const resolved = createRequire(join(GENERATOR, 'package.json')).resolve('typescript/package.json');
	const installed = JSON.parse(readFileSync(resolved, 'utf8'));
	assert.equal(installed.version, compiler.version);
	const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
	const key = resolved.slice(ROOT.length).split(/[\\/]/u).slice(0, -1).join('/');
	assert.equal(lock.packages[key].integrity, compiler.integrity, key);
	assert.equal(verifiedCompiler(compiler.version), compiler);
	assert.throws(
		() => verifiedCompiler('5.8.3'),
		(error) => error instanceof UpstreamError && /5\.9\.3/u.test(error.message)
	);
});

test('every fact of every artifact traces to the line of the source it cites', () => {
	for (const [library, artifact] of Object.entries(artifacts))
		assert.deepEqual(untracedFacts(ROOT, artifact), [], library);
});

test('a fact TypeScript lib declares cites the compiler, as derived, never as authoritative', () => {
	const rgba = highcharts.definitions.RGBA.properties;
	for (const member of ['toString', 'push', 'concat']) {
		assert.equal(rgba[member].provenance.confidence, 'derived', member);
		assert.equal(rgba[member].provenance.sources.length, 1, member);
		assert.equal(rgba[member].provenance.sources[0].source, 'typescript', member);
		assert.match(rgba[member].provenance.sources[0].pointer, /^typescript\/lib\/lib\.es5\.d\.ts:\d+$/u, member);
	}
	assert.deepEqual(untracedFacts(ROOT, highcharts), []);
	for (const [library, artifact] of Object.entries(artifacts)) {
		const authoritative = JSON.stringify(artifact).match(
			/"confidence":"authoritative","sources":\[[^\]]*"source":"typescript"/u
		);
		assert.equal(authoritative, null, library);
	}
});

test('a pointer to a line that declares its property, derives it or synthesizes it traces', () => {
	const radius = lineOf('chart.js/dist/types/index.d.ts', '  radius: number;');
	const mapped = lineOf('chart.js/dist/types/utils.d.ts', '[P in keyof T]');
	const traces = (artifact) => assert.deepEqual(untracedFacts(ROOT, artifact), []);
	traces(citing('radius', `chart.js/dist/types/index.d.ts:${String(radius)}`));
	// A key remapping (`point${Capitalize<K>}`) cites the key it is derived from; a mapped type synthesizes keys.
	traces(citing('pointRadius', `chart.js/dist/types/index.d.ts:${String(radius)}`));
	traces(citing('bar', `chart.js/dist/types/utils.d.ts:${String(mapped)}`));
	// A derived fact is not held to the line; its file and line must still exist.
	traces(citing('anything', `chart.js/dist/types/index.d.ts:${String(radius)}`, { confidence: 'derived' }));
	traces(citing('toString', 'typescript/lib/lib.es5.d.ts:1', { source: 'typescript', confidence: 'derived' }));
});

test('a pointer outside its source, past its file or at a line that does not declare its property is reported', () => {
	const radius = lineOf('chart.js/dist/types/index.d.ts', '  radius: number;');
	const fails = (artifact, message) =>
		assert.match(untracedFacts(ROOT, artifact).join('\n'), message, JSON.stringify(artifact.definitions));
	fails(citing('borderWidth', `chart.js/dist/types/index.d.ts:${String(radius)}`), /does not declare "borderWidth"/u);
	fails(citing('adius', `chart.js/dist/types/index.d.ts:${String(radius)}`), /does not declare "adius"/u);
	fails(citing('radius', 'chart.js/dist/types/index.d.ts:999999'), /names no line of chart\.js/u);
	fails(citing('radius', 'chart.js/dist/types/missing.d.ts:1'), /names no line of chart\.js/u);
	fails(citing('radius', 'chart.js/../echarts/package.json:1'), /names no line of chart\.js/u);
	fails(citing('radius', 'echarts/types/dist/shared.d.ts:1'), /is not a line of a file of source "chartjs"/u);
	fails(citing('radius', 'chart.js/dist/types/index.d.ts:1', { source: 'unknown' }), /source "unknown"/u);
	fails(citing('radius', 'chart.js/dist/types/index.d.ts'), /is not a line of a file/u);
	fails(citing('radius', 'chart.js/dist/types/index.d.ts:0'), /is not a line of a file/u);
});

test('option names are data: a property or definition named like an IR field is walked as one (D17)', () => {
	const radius = lineOf('chart.js/dist/types/index.d.ts', '  radius: number;');
	for (const name of ['provenance', 'properties', 'node', 'kind', 'anyOf']) {
		const artifact = citing(name, 'chart.js/dist/types/index.d.ts:999999');
		artifact.definitions[name] = artifact.definitions.Options;
		assert.deepEqual(
			untracedFacts(ROOT, artifact).sort(),
			[
				`definitions.${name}.properties.${name}: chart.js/dist/types/index.d.ts:999999 names no line of chart.js`,
				`definitions.Options.properties.${name}: chart.js/dist/types/index.d.ts:999999 names no line of chart.js`
			].sort(),
			name
		);
		assert.deepEqual(
			untracedFacts(ROOT, citing(name, `chart.js/dist/types/index.d.ts:${String(radius)}`, { confidence: 'derived' })),
			[]
		);
	}
});
