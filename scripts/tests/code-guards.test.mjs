import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SOURCES } from '../../tools/conformance/corpus/sources.mjs';
import { corpusFile } from '../../tools/conformance/lib/corpus.mjs';
import { isRedistributable } from '../../tools/schema-generator/generate.mjs';
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

const outsideTests = (entries) => entries.filter(({ path }) => !path.split(sep).includes('tests'));

test('R1 layering: @chartguard/core knows no diagnostic code of any other package', () => {
	assert.deepEqual(codeNames(sources('packages/core/src')), []);
});

test('R2 single source of truth: only core/result.ts derives valid and status', () => {
	const entries = sources('packages').filter(
		({ path }) => path.split(sep).includes('src') && !path.endsWith(join('core', 'src', 'result.ts'))
	);
	assert.deepEqual(resultFields(entries), []);
});

test('R3 portability: main-module detection compares resolved paths, never URL text', () => {
	assert.deepEqual(fileUrlText(outsideTests([...sources('scripts'), ...sources('tools'), ...sources('packages')])), []);
});

test('R4 hooks only check: no git hook rewrites or re-stages files', () => {
	const { scripts } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	for (const { path, text } of sources('.husky', ['pre-commit', 'pre-push']))
		assert.equal(rewritesFiles(text, scripts), false, path);
	for (const name of ['precommit', 'prepush']) assert.equal(rewritesFiles(scripts[name], scripts), false, name);
});

test('R5 one engines policy: every workspace package declares the root Node range', () => {
	const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
	const manifests = files(join(ROOT, 'packages'), ['package.json']).filter((path) => !path.includes('node_modules'));
	for (const path of manifests) {
		const { name, engines } = JSON.parse(readFileSync(path, 'utf8'));
		assert.equal(engines?.node, root.engines.node, name);
	}
});

test('R6 quality facts: every chart-semantics field is a Fact, a list of facts or a named structural field, never a bare value (B3, CG-05-02)', () => {
	const chart = readFileSync(join(ROOT, 'packages/quality/core/src/chart.ts'), 'utf8');
	const interfaces = chart
		.split(/^export interface /m)
		.slice(1)
		.map((block) => ({
			name: /^\w+/.exec(block)[0],
			fields: [...block.matchAll(/^\s*(readonly \w+\??: .*)$/gm)].map((match) => match[1].trim())
		}));
	// A payload is carried inside a Fact (`Fact<ValueSummary>`), or inside another payload: the Fact gives it its path.
	const payloads = new Set(interfaces.filter(({ name }) => chart.includes(`Fact<${name}>`)).map(({ name }) => name));
	const carried = ({ fields }) => interfaces.filter((other) => fields.some((field) => field.includes(other.name)));
	for (const block of interfaces)
		if (payloads.has(block.name)) carried(block).forEach(({ name }) => payloads.add(name));
	const STRUCTURAL =
		/^readonly (path|key|library): string;$|^readonly \w+: (Fact<|Listed<|readonly \w+Semantics\[\]|\w+Semantics;)/;
	const bare = interfaces
		.filter(({ name }) => !payloads.has(name))
		.flatMap(({ fields }) => fields.filter((field) => !STRUCTURAL.test(field)));
	assert.ok(interfaces.length > 0);
	assert.deepEqual(bare, []);
	// A payload that holds a value holds where it was read from.
	const pathless = interfaces.filter(
		({ name, fields }) =>
			payloads.has(name) &&
			fields.some((field) => field.startsWith('readonly value:')) &&
			!fields.includes('readonly path: string;')
	);
	assert.deepEqual(
		pathless.map(({ name }) => name),
		[]
	);
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
	const modules = (directory) => sources(directory, ['.mjs']);
	const all = [...modules('tools'), ...modules('apps'), ...modules('scripts'), ...modules('packages')];
	const candidates = outsideTests([...modules('tools'), ...modules('apps'), ...modules('scripts')]).filter(
		({ path }) => path !== join('tools', 'shared', 'entry.mjs')
	);
	const scripts = scriptsAmong(candidates, all);
	// The repository's own scripts are found: build, test, the boundary check, the generators.
	for (const script of ['build.mjs', 'test.mjs', 'check-boundaries.mjs'])
		assert.ok(
			scripts.some(({ path }) => path === join('scripts', script)),
			script
		);
	assert.deepEqual(entryWork(scripts), []);
});

test('R10 runtime facts are read from the pinned package through one helper that cites the line (D16)', () => {
	// The generators read facts from the pinned packages; the conformance harness only loads them to run.
	const allowed = new Set(['runtime.mjs', 'lock.mjs'].map((file) => join('packages', 'schema-generator', 'lib', file)));
	const readers = outsideTests([
		...sources('tools/schema-generator'),
		...sources('tools/docs'),
		...sources('tools/api'),
		...sources('packages/schema-generator', ['.mjs'])
	]).filter(({ path }) => !allowed.has(path));
	assert.ok(readers.length >= 20, 'the generator sources are found');
	assert.deepEqual(nodeModulesPaths(readers), []);
});

test('R11 a value handed to another process is checked structurally, not by a JSON round trip that drops functions (E20)', () => {
	const code = [...sources('tools'), ...sources('apps'), ...sources('packages')];
	assert.deepEqual(jsonRoundTrips(code), []);
});

/** Schema artifacts (`irVersion` + `library`) among JSON files, with whether their upstream license allows shipping them. */
function artifactsIn(paths) {
	const upstream = JSON.parse(readFileSync(join(ROOT, 'packages/schema-generator/upstream-sources.json'), 'utf8'));
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
	// Tracked files deleted in the working tree (a move not committed yet) have nothing to check.
	const found = artifactsIn(tracked.stdout.split('\0').filter((path) => path !== '' && existsSync(join(ROOT, path))));
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

test('R12 an example corpus whose license does not clear redistribution is local only and never tracked (CG-01-05)', () => {
	const local = Object.keys(SOURCES).filter((library) => SOURCES[library].redistributable === false);
	assert.deepEqual(local, ['highcharts']);
	for (const library of local) assert.equal(relative(ROOT, corpusFile(library)).split(sep)[0], 'node_modules', library);
	const tracked = spawnSync('git', ['ls-files', '-z', '--', 'tools/conformance/corpus'], {
		cwd: ROOT,
		encoding: 'utf8'
	});
	const corpora = tracked.stdout.split('\0').filter((path) => path.endsWith('.json'));
	assert.deepEqual(
		corpora.filter((path) => local.some((library) => path.endsWith(`${library}.json`))),
		[]
	);
});

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

test('R13 cross-option rules read the config only through readOwn/itemsOf, never by casting it to a record (A27)', () => {
	const rules = [
		...sources('packages/config/echarts/src/rules'),
		...sources('packages/config/chartjs/src').filter(({ path }) => path.endsWith('rules.ts')),
		...sources('packages/config/core/src').filter(({ path }) => path.endsWith('rules.ts'))
	];
	assert.ok(rules.length >= 5, 'the rule sources are found');
	assert.deepEqual(recordCasts(rules), []);
});

test('R8 entry points: process.argv[1] is resolved only by the guarded helpers, never at import time unguarded', () => {
	const allowed = new Set([join('tools', 'shared', 'entry.mjs'), join('packages', 'cli', 'bin', 'chartguard.mjs')]);
	const entries = [...sources('tools'), ...sources('scripts'), ...sources('packages')].filter(
		({ path }) => !allowed.has(path) && !path.split(sep).includes('tests')
	);
	assert.deepEqual(argvScript(entries), []);
});
