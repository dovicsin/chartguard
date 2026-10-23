import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	argvScript,
	codeNames,
	entryWork,
	fileUrlText,
	jsonRoundTrips,
	nodeModulesPaths,
	recordCasts,
	resultFields,
	rewritesFiles,
	scriptsAmong
} from './syntax-guards.mjs';

/**
 * Each code guard on code it must catch, including the spellings a text pattern let through (H12),
 * and on code it must let pass: a guard that catches nothing guards nothing.
 */
const caught = (guard, text, path = 'src/sample.ts') => guard([{ path, text }]).length > 0;

function expectGuard(guard, { bad, good }, path) {
	for (const text of bad) assert.equal(caught(guard, text, path), true, `must catch: ${text}`);
	for (const text of good) assert.equal(caught(guard, text, path), false, `must pass: ${text}`);
}

test('R1 catches a code of another package in any string, also as a prefix or in a template', () => {
	expectGuard(codeNames, {
		bad: [
			"const code = 'CFG_TYPE';",
			"if (code.startsWith('CFG_')) {}",
			'const x = `VIS_${name}`;',
			'const y = "AST_" + rest;'
		],
		good: ["const code = 'TOO_COMPLEX';", '// CFG_TYPE in a comment is documentation', 'const CFG = 1;']
	});
});

test('R2 catches valid or status written as a property, a shorthand or an assignment', () => {
	expectGuard(resultFields, {
		bad: [
			'const r = { valid: true };',
			'return { valid, status };',
			'result.valid = false;',
			"result['status'] = 'invalid';",
			"const r = { 'valid': x };"
		],
		good: [
			'interface R { readonly valid: boolean; readonly status: ValidationStatus }',
			'const { valid, status } = result;',
			'if (result.valid) run();',
			'const r = { ...checked, ...result(library, version, coverage, diagnostics) };'
		]
	});
});

test('R3 catches a file URL built as text, however it is concatenated', () => {
	expectGuard(fileUrlText, {
		bad: [
			"const url = 'file://' + process.argv[1];",
			'const url = `file://${path}`;',
			"if (import.meta.url === 'file:///x') {}"
		],
		good: ['const url = pathToFileURL(path).href;', '// see file://docs (a comment)']
	});
});

test('R4 catches a hook or script that writes, also through npm run and short flags', () => {
	const scripts = { format: 'prettier --write .', lint: 'eslint .', check: 'npm run lint && npm run format' };
	for (const command of [
		'prettier -w .',
		'eslint --fix .',
		'npm run lint:fix',
		'git add -A',
		'git update-index --again',
		'npm run format',
		'npm run check'
	])
		assert.equal(rewritesFiles(command, scripts), true, command);
	for (const command of ['prettier --check .', 'eslint .', 'npm run lint', 'npm test', 'node scripts/prefix.mjs'])
		assert.equal(rewritesFiles(command, scripts), false, command);
	// A script that refers to itself is read once.
	assert.equal(rewritesFiles('npm run loop', { loop: 'npm run loop' }), false);
});

test('R8 catches process.argv[1] read by index or by at(1), however resolved', () => {
	expectGuard(argvScript, {
		bad: [
			'const path = realpathSync.native(process.argv[1]);',
			"const path = realpathSync(process['argv'][1]);",
			'const script = process.argv.at(1);',
			'if (import.meta.url === pathToFileURL(process.argv[1]).href) main();'
		],
		good: ['const args = process.argv.slice(2);', 'const node = process.argv[0];']
	});
});

test('R9 finds scripts by the import graph and catches work outside the entry branch', () => {
	const library = { path: join('tools', 'lib', 'shared.mjs'), text: 'export const value = 1;' };
	const script = (text) => ({ path: join('tools', 'run.mjs'), text });
	const importer = {
		path: join('tools', 'other.mjs'),
		text: "import { value } from './lib/shared.mjs';\nawait runAsEntryPoint(import.meta.url, () => value);"
	};
	const all = [library, importer];
	// A module nothing imports is a script; an imported one is a library unless it calls runAsEntryPoint.
	assert.deepEqual(
		scriptsAmong([library, importer], all).map(({ path }) => path),
		[importer.path]
	);
	for (const text of [
		'const tests = find();\nspawnSync(node, tests);',
		'if (import.meta.url === pathToFileURL(process.argv[1]).href) main();',
		'main().then(() => process.exit(0));\nawait runAsEntryPoint(import.meta.url, main);',
		'if (isEntryPoint(import.meta.url)) main();'
	])
		assert.notDeepEqual(entryWork([script(text)]), [], text);
	assert.deepEqual(
		entryWork([script('function main() { return 0; }\nawait runAsEntryPoint(import.meta.url, main);')]),
		[]
	);
});

test('R10 catches a node_modules path built by hand: an argument, a template, a concatenation', () => {
	expectGuard(
		nodeModulesPaths,
		{
			bad: [
				"const file = join(root, 'node_modules', name);",
				'const file = `${root}/node_modules/${name}`;',
				"const file = root + '/node_modules/' + name;",
				"const url = new URL('../node_modules/x/package.json', import.meta.url);"
			],
			good: ["const SKIPPED = new Set(['dist', 'node_modules']);", "if (entry.name !== 'node_modules') walk(entry);"]
		},
		'lib/reader.mjs'
	);
});

test('R11 catches a JSON round trip, also with whitespace or nested in a call', () => {
	expectGuard(jsonRoundTrips, {
		bad: ['const copy = JSON.stringify(JSON.parse(text));', 'send(JSON.stringify(\n\tJSON.parse(text)\n));'],
		good: ['const copy = structuredClone(value);', 'const text = JSON.stringify(value);']
	});
});

test('R13 catches a cast to any record type, also wrapped or through unknown', () => {
	expectGuard(recordCasts, {
		bad: [
			'const map = value as Record<string, unknown>;',
			'const map = value as Partial<Record<string, unknown>>;',
			'const map = value as unknown as { [key: string]: unknown };',
			'const map = <Record<string, number>>value;'
		],
		good: ['const read = readOwn(value, key);', 'const list = value as readonly unknown[];']
	});
});
