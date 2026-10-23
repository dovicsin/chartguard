import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCorpus } from '../lib/sandbox.mjs';

/**
 * What upstream example code can reach (K6, E12). A `vm` context is not a security boundary: through
 * any object handed in (`Chart`) the code reaches the host realm's `globalThis`, `process` and
 * `fetch`. The boundary is the child process: the permission model (no writes, no child processes,
 * no workers) and an environment that holds nothing (no tokens, no paths).
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

test('example code that escapes the vm context finds an empty environment and cannot write', (t) => {
	// The child may read the repository only: the probe corpus lives in its ignored cache.
	const cache = join(ROOT, 'node_modules', '.cache', 'chartguard');
	mkdirSync(cache, { recursive: true });
	const directory = mkdtempSync(join(cache, 'sandbox-probe-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const code = `
		const host = Chart.constructor('return globalThis')();
		const variables = Object.keys(host.process.env).filter((name) => name !== 'NODE_V8_COVERAGE');
		let wrote = 'no';
		try { host.process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(join(directory, 'escaped'))}, 'x'); wrote = 'yes'; } catch {}
		module.exports = { config: { type: 'bar', data: { datasets: [] }, options: { ['env' + variables.length + 'wrote' + wrote]: 1 } } };
	`;
	const corpus = join(directory, 'corpus.json');
	writeFileSync(corpus, JSON.stringify({ library: 'chartjs', files: [{ path: 'probe', code }] }));
	const outcomes = runCorpus('chartjs', corpus);
	if (outcomes === undefined) return t.skip('this Node version has no permission model');
	const [{ status, findings }] = outcomes;
	assert.equal(status, 'ran');
	assert.ok(
		findings.some((finding) => finding.endsWith('$.options.env0wroteno')),
		findings.join('\n')
	);
	return undefined;
});
