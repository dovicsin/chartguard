import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ciDetection, rootPathText } from './portability-guards.mjs';

/**
 * R14 and R15 (E2, E22): portability guards on the syntax tree, each tested on the spellings it
 * must catch and on code it must pass (E38), then applied to every tool, script and app source.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.git', 'generated', 'tests']);

function files(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return SKIPPED.has(entry.name) ? [] : files(path);
		return /\.(?:mjs|ts)$/u.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
	});
}

const sources = (...directories) =>
	directories
		.flatMap((directory) => files(join(ROOT, directory)))
		.map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

const caught = (guard, text) => guard([{ path: 'tools/x/sample.mjs', text }]).length > 0;

function expectGuard(guard, { bad, good }) {
	for (const text of bad) assert.equal(caught(guard, text), true, `must catch: ${text}`);
	for (const text of good) assert.equal(caught(guard, text), false, `must pass: ${text}`);
}

test('R14 catches a path built as text from a root or directory, in a template or a concatenation', () => {
	expectGuard(rootPathText, {
		bad: [
			'const FILE = `${ROOT}packages/config/x.json`;',
			'const file = `${root}/dist/index.js`;',
			'const file = `${outDir}${name}/index.html`;',
			"const file = ROOT + 'packages/x.json';",
			"const file = directory + '/x.json';",
			"const file = packageDir + sep + 'x' + '/y';"
		],
		good: [
			"const FILE = join(ROOT, 'packages', 'config', 'x.json');",
			'const message = `${library}/${name} is not registered`;',
			'const url = `http://127.0.0.1:${port}/`;',
			"const label = root + ': ' + name;",
			'const hint = `${dir} is empty`;'
		]
	});
});

test('R15 catches CI detected by hand instead of through tools/shared/ci.mjs', () => {
	expectGuard(ciDetection, {
		bad: [
			"if (process.env['CI'] !== undefined) throw new Error('x');",
			'if (process.env.CI) fail();',
			"const onCi = env['GITHUB_ACTIONS'] === 'true';",
			'const { CI } = process.env;',
			'const jenkins = process.env.JENKINS_URL;'
		],
		good: ["if (isCi()) throw new Error('x');", "const path = process.env['CHROME_PATH'];", 'const ci = config.CI;']
	});
});

test('R14 no tool, script or app builds a path as text from its root (E2)', () => {
	const code = sources('tools', 'scripts', 'apps', 'packages/schema-generator');
	assert.ok(code.length >= 30, 'the sources are found');
	assert.deepEqual(rootPathText(code), []);
});

test('R15 CI is detected in one place, which knows the common CI services (E22)', () => {
	const code = sources('tools', 'scripts', 'apps', 'packages/schema-generator');
	const others = [...code, ...sources('tools/conformance/tests', 'apps/playground/tests')].filter(
		({ path }) => path !== join('tools', 'shared', 'ci.mjs')
	);
	assert.deepEqual(ciDetection(others), []);
});
