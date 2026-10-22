import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { example, run } from './helpers.mjs';

test('wrong arguments have usage error status', async () => assert.equal((await run(['validate'])).code, 2));

test('help exits cleanly', async () => assert.equal((await run(['help'])).code, 0));

test('unknown library and unknown flags are usage errors', async () => {
	assert.equal((await run(['validate', '--library', 'd3', '--file', 'x.json'])).code, 2);
	assert.equal((await run(['validate', '--library', 'chartjs', '--file', 'x.json', '--bogus'])).code, 2);
});

test('confirmed config errors exit 1', async () => {
	const { code, out } = await run(['validate', '--library', 'chartjs', '--file', example('chartjs-invalid.json')]);
	assert.equal(code, 1);
	assert.match(out, /ERROR CFG_TYPE \$\.options\.scales\.y\.min/);
});

test('clean partial config exits 0 and says coverage is partial', async () => {
	const { code, out } = await run(['validate', '--library', 'chartjs', '--file', example('chartjs-valid-subset.json')]);
	assert.equal(code, 0);
	assert.match(out, /NOTE: partial schema coverage/);
});

test('quality json output is tagged with its mode, is advisory and points at the option', async () => {
	const argv = ['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json'), '--json'];
	const { code, out } = await run(argv);
	const report = JSON.parse(out);
	assert.equal(code, 0);
	assert.equal(report.mode, 'quality');
	assert.equal(report.valid, undefined);
	assert.deepEqual(
		report.diagnostics.map((d) => [d.code, d.path]),
		[
			['VIS_BAR_BASELINE', '$.options.scales.y.min'],
			// The example has no titles: nothing says what is measured.
			['VIS_VALUE_AXIS_UNTITLED', '$.options.scales.y.title.text']
		]
	);
	// A verified fix comes with its finding: the edit, what it held, and what changes (CG-05-06).
	assert.deepEqual(report.diagnostics[0].fix, {
		kind: 'set-option',
		path: '$.options.scales.y.min',
		from: 85,
		value: 0,
		effect: 'The bars grow from zero again, so their lengths are proportional to their values.'
	});
	assert.equal(report.diagnostics[1].fix, undefined);
	const text = await run(['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json')]);
	assert.match(text.out, /advisory/);
	assert.match(text.out, /\n {4}FIX \$\.options\.scales\.y\.min = 0: The bars grow from zero again/);
});

test('validate json output is tagged with its mode', async () => {
	const argv = ['validate', '--library', 'chartjs', '--file', example('chartjs-valid-subset.json'), '--json'];
	assert.equal(JSON.parse((await run(argv)).out).mode, 'validate');
});

test('malformed JSON input is an input failure with the file named, not an internal failure', async () => {
	const { code, err } = await run(['validate', '--library', 'chartjs', '--file', example('chartjs-source.ts')]);
	assert.equal(code, 2);
	assert.match(err, /chartjs-source\.ts is not valid JSON/);
	assert.doesNotMatch(err, /internal failure/);
});

test('analyze reports unknown keys as warnings, not errors', async () => {
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts')]);
	assert.equal(code, 0);
	assert.match(
		out,
		/warning: \S+chartjs-source\.ts:5:\d+ \$\.options\.scales\.y\.beginAtZerro .* Did you mean "beginAtZero"\?/
	);
});

test('analyze json lists entries', async () => {
	const argv = ['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts'), '--json'];
	const report = JSON.parse((await run(argv)).out);
	assert.deepEqual(
		report.entries.map((entry) => [entry.name, entry.complete, entry.result.status]),
		[['config', true, 'partial']]
	);
});

test('a BOM-prefixed JSON file is read like any other', async () => {
	const { code } = await run(['validate', '--library', 'chartjs', '--file', example('chartjs-bom.json')]);
	assert.equal(code, 0);
});

test('analyze without a matching variable fails with an explanation', async () => {
	const argv = ['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts'), '--name', 'missing'];
	const { code, err } = await run(argv);
	assert.equal(code, 2);
	assert.match(err, /No chartjs chart use and no suitable static object found/);
});

test('unreadable files are input failures', async () => {
	const { code, err } = await run(['validate', '--library', 'echarts', '--file', example('missing.json')]);
	assert.equal(code, 2);
	assert.match(err, /^ChartGuard: Cannot read .*missing\.json/);
});

test('analyze never validates a let config: its initializer may be stale, so it explains instead', async () => {
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-let-source.ts')]);
	assert.equal(code, 0);
	assert.match(out, /^config @ line 1: not validated \(dynamic \/ partial\)$/m);
	assert.match(out, /config is declared with let and may be reassigned/);
	assert.doesNotMatch(out, /error/);
	const json = JSON.parse(
		(await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-let-source.ts'), '--json'])).out
	);
	assert.equal(json.entries[0].result, undefined);
	assert.deepEqual(
		json.entries[0].notes.map((d) => d.code),
		['CFG_REASSIGNABLE', 'CFG_MUTATED']
	);
});

test('analyze refuses a file with syntax errors instead of validating a recovered tree', async () => {
	const { code, err } = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-syntax-error.ts')]);
	assert.equal(code, 2);
	assert.match(err, /cannot be read reliably; nothing read from it is used/);
	assert.match(err, /1:30 /);
});

test('help words and misplaced options', async () => {
	assert.equal((await run(['-h'])).code, 0);
	assert.equal((await run(['validate', '--library', 'chartjs', '--file', 'x.json', '--name', 'config'])).code, 2);
	assert.equal((await run(['validate', 'extra', '--library', 'chartjs', '--file', 'x.json'])).code, 2);
});

const BIN = fileURLToPath(new URL('../bin/chartguard.mjs', import.meta.url));

test('a reader that closes the pipe early is not a crash', { skip: process.platform === 'win32' }, () => {
	const command = `"${process.execPath}" "${BIN}" analyze --library chartjs --file "${example('chartjs-source.ts')}" | head -c 1`;
	const child = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
	assert.equal(child.stderr, '');
});

test('importing the bin from a non-path argv runs nothing and does not throw', () => {
	const script = `await import(${JSON.stringify(new URL('../bin/chartguard.mjs', import.meta.url).href)});`;
	const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, 'not-a-path'], { encoding: 'utf8' });
	assert.deepEqual([child.status, child.stdout, child.stderr], [0, '', '']);
});

test('--library-version: another minor downgrades confirmed errors, another major is not validated', async () => {
	const file = example('chartjs-invalid.json');
	const minor = await run(['validate', '--library', 'chartjs', '--file', file, '--library-version', '4.4.1', '--json']);
	assert.equal(minor.code, 0);
	const downgraded = JSON.parse(minor.out);
	assert.equal(downgraded.status, 'partial');
	assert.deepEqual(
		downgraded.diagnostics.map((d) => `${d.severity} ${d.code}`),
		['warning CFG_VERSION_MISMATCH', 'warning CFG_UNKNOWN_KEY', 'warning CFG_TYPE']
	);
	const major = await run(['validate', '--library', 'chartjs', '--file', file, '--library-version', '3.9.1']);
	assert.equal(major.code, 0);
	assert.match(major.out, /CFG_UNSUPPORTED_VERSION \$: 3\.9\.1 is not supported/);
	const exact = await run(['validate', '--library', 'chartjs', '--file', file, '--library-version', '4.5.1']);
	assert.equal(exact.code, 1);
	assert.equal((await run(['quality', '--library', 'chartjs', '--file', file, '--library-version', '4.5.1'])).code, 2);
});

test('--library-version auto finds the installed package upward from the file', async (t) => {
	const project = mkdtempSync(join(tmpdir(), 'chartguard-project-'));
	t.after(() => rmSync(project, { recursive: true, force: true }));
	mkdirSync(join(project, 'node_modules', 'chart.js'), { recursive: true });
	mkdirSync(join(project, 'src', 'charts'), { recursive: true });
	writeFileSync(
		join(project, 'node_modules', 'chart.js', 'package.json'),
		JSON.stringify({ name: 'chart.js', version: '4.4.0' })
	);
	const file = join(project, 'src', 'charts', 'bar.json');
	writeFileSync(file, JSON.stringify({ type: 'bar', data: { datasets: [] }, options: { responsive: 'yes' } }));
	const found = await run(['validate', '--library', 'chartjs', '--file', file, '--library-version', 'auto', '--json']);
	assert.equal(found.code, 0);
	assert.match(JSON.parse(found.out).diagnostics[0].message, /4\.4\.0 may accept or reject/);
	const missing = await run(['validate', '--library', 'echarts', '--file', file, '--library-version', 'auto']);
	assert.equal(missing.code, 2);
	assert.match(missing.err, /echarts is not installed for .*charts; pass --library-version/);
});

test('analyze passes the version on to every extracted config', async () => {
	const { out } = await run([
		'analyze',
		'--library',
		'chartjs',
		'--file',
		example('chartjs-source.ts'),
		'--library-version',
		'3.0.0'
	]);
	assert.match(out, /^config @ line 2: partial$/m);
	assert.match(
		out,
		/warning: \S+ \$ 3\.0\.0 is not supported: this schema describes chartjs 4\.5\.1\. Not validated\./
	);
});
