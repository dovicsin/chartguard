import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { main } from '../bin/chartguard.mjs';

async function run(argv) {
	const out = [];
	const err = [];
	const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A project with a config, a source file and registry context files. */
function project(t) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-registries-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const write = (name, content) => {
		const path = join(directory, name);
		writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
		return path;
	};
	return {
		config: write('chart.json', { type: 'line', data: { datasets: [{ type: 'bar', data: [1] }] } }),
		source: write(
			'chart.ts',
			"export const config = { type: 'line', data: { datasets: [{ type: 'bar', data: [1] }] } };"
		),
		lineOnly: write('registries.json', { 'chartjs.controllers': { names: ['line'], complete: true } }),
		write
	};
}

test('--registries: validate checks against what the runtime registered', async (t) => {
	const files = project(t);
	const result = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		files.config,
		'--registries',
		files.lineOnly,
		'--json'
	]);
	assert.equal(result.code, 1);
	assert.deepEqual(
		JSON.parse(result.out).diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_UNREGISTERED $.data.datasets[0].type']
	);
	assert.equal((await run(['validate', '--library', 'chartjs', '--file', files.config])).code, 0);
});

test('--registries: analyze passes the context on to every extracted config', async (t) => {
	const files = project(t);
	const { code, out } = await run([
		'analyze',
		'--library',
		'chartjs',
		'--file',
		files.source,
		'--registries',
		files.lineOnly
	]);
	assert.equal(code, 1);
	assert.match(out, /error: \S+chart\.ts:1:\d+ \$\.data\.datasets\[0\]\.type "bar" is not registered with the runtime/);
});

test('--registries: a missing or unparsable file is an input error; a malformed context is reported, not fatal', async (t) => {
	const files = project(t);
	const missing = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		files.config,
		'--registries',
		join(files.config, 'nope.json')
	]);
	assert.equal(missing.code, 2);
	assert.match(missing.err, /Cannot read .*nope\.json/);
	const broken = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		files.config,
		'--registries',
		files.write('broken.json', '{')
	]);
	assert.equal(broken.code, 2);
	assert.match(broken.err, /broken\.json is not valid JSON/);
	const malformed = files.write('malformed.json', { 'chartjs.controllers': ['line'] });
	const reported = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		files.config,
		'--registries',
		malformed,
		'--json'
	]);
	assert.equal(reported.code, 0);
	assert.deepEqual(
		JSON.parse(reported.out).diagnostics.map((d) => d.code),
		['CFG_REGISTRY_CONTEXT']
	);
});

test('--registries belongs to the config checks, not to quality', async (t) => {
	const files = project(t);
	assert.equal(
		(await run(['quality', '--library', 'chartjs', '--file', files.config, '--registries', files.lineOnly])).code,
		2
	);
});
