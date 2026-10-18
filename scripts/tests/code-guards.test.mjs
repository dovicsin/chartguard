import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('R8 entry points: process.argv[1] is resolved only by the guarded helpers, never at import time unguarded', () => {
	const allowed = new Set([join('tools', 'shared', 'entry.mjs'), join('packages', 'cli', 'bin', 'chartguard.mjs')]);
	const entries = [...sources('tools'), ...sources('scripts'), ...sources('packages')].filter(
		({ path }) => !allowed.has(path) && !path.split(sep).includes('tests')
	);
	assert.deepEqual(offenders(entries, /realpathSync\(\s*(invokedPath|process\.argv)/), []);
});
