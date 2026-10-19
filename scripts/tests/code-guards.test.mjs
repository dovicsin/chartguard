import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isRedistributable } from '../../tools/schema-generator/generate.mjs';

/**
 * Mechanical guards for defect classes this codebase has already shipped once.
 * Each test names the rule in docs/process/review-checklist.md it enforces.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.git', 'generated']);

function files(directory, extensions) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : files(path, extensions);
		return extensions.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
	});
}

const sources = (directory, extensions = ['.ts', '.mjs']) =>
	files(join(ROOT, directory), extensions).map((path) => ({
		path: relative(ROOT, path),
		text: readFileSync(path, 'utf8')
	}));

const offenders = (entries, pattern) => entries.filter(({ text }) => pattern.test(text)).map(({ path }) => path);

test('R1 layering: @chartguard/core knows no diagnostic code of any other package', () => {
	assert.deepEqual(offenders(sources('packages/core/src'), /\b(CFG|VIS|AST)_[A-Z_]+\b/), []);
});

test('R2 single source of truth: only core/result.ts derives valid and status', () => {
	// The whitespace lives inside the lookahead, so backtracking cannot slip past the type name.
	const literal = /\b(valid|status):(?!\s*(boolean|ValidationStatus)\b)/;
	const entries = sources('packages').filter(
		({ path }) => path.split(sep).includes('src') && !path.endsWith(join('core', 'src', 'result.ts'))
	);
	assert.deepEqual(offenders(entries, literal), []);
});

test('R3 portability: main-module detection compares resolved paths, never URL text', () => {
	assert.deepEqual(offenders(sources('scripts').concat(sources('tools'), sources('packages')), /file:\/\/\$\{/), []);
});

test('R4 hooks only check: no git hook rewrites or re-stages files', () => {
	for (const { path, text } of sources('.husky', ['pre-commit', 'pre-push']))
		assert.doesNotMatch(text, /fix|--write|update-index|git add/, path);
	const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	for (const name of ['precommit', 'prepush'])
		assert.doesNotMatch(scripts[name], /fix-|--write|--fix|update-index/, name);
});

test('R5 one engines policy: every workspace package declares the root Node range', () => {
	const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	const manifests = files(join(ROOT, 'packages'), ['package.json']).filter((path) => !path.includes('node_modules'));
	for (const path of manifests) {
		const { name, engines } = JSON.parse(readFileSync(path, 'utf8'));
		assert.equal(engines?.node, root.engines.node, name);
	}
});

test('R6 no mutable quality facts: rules receive facts with paths, never bare values', () => {
	const chart = readFileSync(join(ROOT, 'packages/quality/core/src/chart.ts'), 'utf8');
	const bare = [...chart.matchAll(/^\s*readonly \w+\?: (?!Fact<)/gm)].map((match) => match[0].trim());
	assert.deepEqual(bare, []);
});

test('R7 shipped files are tracked: every non-build entry in a package `files` list exists and is not git-ignored', () => {
	const manifests = files(join(ROOT, 'packages'), ['package.json']).filter((path) => !path.includes('node_modules'));
	const shipped = manifests.flatMap((manifest) => {
		const directory = join(manifest, '..');
		const entries = JSON.parse(readFileSync(manifest, 'utf8')).files ?? [];
		return entries.filter((entry) => !entry.startsWith('dist')).map((entry) => join(directory, entry));
	});
	assert.deepEqual(
		shipped.filter((path) => !existsSync(path)).map((path) => relative(ROOT, path)),
		[]
	);
	const ignored = spawnSync('git', ['check-ignore', '--no-index', ...shipped.map((path) => relative(ROOT, path))], {
		cwd: ROOT,
		encoding: 'utf8'
	});
	if (ignored.error !== undefined) return;
	assert.equal(ignored.stdout.trim(), '');
});

test('R9 tool entry points go through runAsEntryPoint, which tolerates a closed stdout pipe', () => {
	const entries = [...sources('tools'), ...sources('apps')].filter(
		({ path }) => path !== join('tools', 'shared', 'entry.mjs') && !path.split(sep).includes('tests')
	);
	assert.deepEqual(offenders(entries, /\bisEntryPoint\(/), []);
});

test('R10 runtime facts are read from the pinned package through one helper that cites the line (D16)', () => {
	const allowed = new Set(['runtime.mjs', 'lock.mjs'].map((file) => join('tools', 'schema-generator', 'lib', file)));
	const readers = sources('tools').filter(({ path }) => !allowed.has(path) && !path.split(sep).includes('tests'));
	assert.deepEqual(offenders(readers, /['"]node_modules['"]\s*,/), []);
});

test('R11 a value handed to another process is checked structurally, not by a JSON round trip that drops functions (E20)', () => {
	const code = [...sources('tools'), ...sources('apps'), ...sources('packages')];
	assert.deepEqual(offenders(code, /JSON\.stringify\(\s*JSON\.parse\(/), []);
});

/** Schema artifacts (`irVersion` + `library`) among JSON files, with whether their upstream license allows shipping them. */
function artifactsIn(paths) {
	const upstream = JSON.parse(readFileSync(join(ROOT, 'tools/schema-generator/upstream-sources.json'), 'utf8'));
	const pins = new Map(upstream.libraries.map((pin) => [pin.library, pin]));
	return paths
		.filter((path) => path.endsWith('.json'))
		.flatMap((path) => {
			const text = readFileSync(join(ROOT, path), 'utf8');
			if (!text.includes('"irVersion"')) return [];
			const { library } = JSON.parse(text);
			const pin = pins.get(library);
			return [{ path, allowed: pin !== undefined && isRedistributable(pin) }];
		});
}

test('R12 no schema artifact whose upstream license does not allow it is tracked by git (CG-01-05)', () => {
	const tracked = spawnSync('git', ['ls-files', '-z', '--', '*.json'], { cwd: ROOT, encoding: 'utf8' });
	assert.equal(tracked.status, 0, tracked.stderr);
	const found = artifactsIn(tracked.stdout.split('\0').filter(Boolean));
	assert.ok(found.length >= 2, 'the committed Chart.js and ECharts artifacts are found');
	assert.deepEqual(
		found.filter(({ allowed }) => !allowed).map(({ path }) => path),
		[]
	);
});

/** `npm <args> --json` in the repository root, parsed. */
function npmJson(args) {
	const result = spawnSync('npm', [...args, '--json'], {
		cwd: ROOT,
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

test('R12 no package publishes a schema artifact whose upstream license does not allow it (CG-01-05)', () => {
	const locations = new Map(npmJson(['query', '.workspace']).map(({ name, location }) => [name, location]));
	const packed = npmJson(['pack', '--dry-run', '--workspaces']).flatMap(({ name, files: entries }) =>
		entries.map(({ path }) => join(locations.get(name), path))
	);
	const found = artifactsIn(packed);
	assert.ok(found.length >= 2, 'the published Chart.js and ECharts artifacts are found');
	assert.deepEqual(
		found.filter(({ allowed }) => !allowed).map(({ path }) => path),
		[]
	);
});

test('R8 entry points: process.argv[1] is resolved only by the guarded helpers, never at import time unguarded', () => {
	const allowed = new Set([join('tools', 'shared', 'entry.mjs'), join('packages', 'cli', 'bin', 'chartguard.mjs')]);
	const entries = [...sources('tools'), ...sources('scripts'), ...sources('packages')].filter(
		({ path }) => !allowed.has(path) && !path.split(sep).includes('tests')
	);
	assert.deepEqual(offenders(entries, /realpathSync\(\s*(invokedPath|process\.argv)/), []);
});
