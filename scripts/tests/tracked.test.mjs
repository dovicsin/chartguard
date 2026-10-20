import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LABELS } from '../labels.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const inRepository = git(['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';

/** What may stay local although it lies below a tracked directory: READMEs (kept local by decision), build output, Highcharts-derived files. */
function mayStayLocal(path) {
	const segments = path.split('/');
	const name = segments.at(-1) ?? '';
	if (name === 'README.md') return true;
	if (segments.some((segment) => ['node_modules', 'dist', 'coverage', '.cache'].includes(segment))) return true;
	if (/\.(?:d\.[cm]?ts|map|tsbuildinfo|log)$/.test(name)) return true;
	return path.startsWith('packages/config/highcharts/src/generated/');
}

test(
	'nothing the build, the tools or the tests need is left out by the allowlist .gitignore',
	{ skip: !inRepository && 'not a git work tree' },
	() => {
		const ignored = git([
			'ls-files',
			'--others',
			'--ignored',
			'--exclude-standard',
			'--',
			'packages',
			'apps',
			'tools',
			'scripts',
			'examples',
			'.changeset'
		])
			.stdout.split('\n')
			.filter((path) => path !== '' && !mayStayLocal(path));
		assert.deepEqual(ignored, [], 'allowlist these paths in .gitignore');
		for (const governance of ['CONTRIBUTING.md', 'SECURITY.md', join('.github', 'CODEOWNERS').split(sep).join('/')])
			assert.equal(git(['check-ignore', '-q', governance]).status, 1, `${governance} must not be ignored`);
	}
);

test('the issue labels are well-formed, and every label the contribution guide names exists', () => {
	const names = LABELS.map(({ name }) => name);
	assert.equal(new Set(names).size, names.length);
	for (const { name, color, description } of LABELS) {
		assert.match(color, /^[0-9a-f]{6}$/, name);
		assert.ok(description.length > 0 && description.length <= 100, name);
	}
	const guide = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8');
	for (const [, label] of guide.matchAll(/`([a-z-]+(?::\*)?)`/g)) {
		if (label.endsWith(':*'))
			assert.ok(
				names.some((name) => name.startsWith(label.slice(0, -1))),
				label
			);
		else if (/^(?:needs-|bug|false-|enhancement|upstream)/.test(label)) assert.ok(names.includes(label), label);
	}
});
