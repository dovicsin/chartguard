import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../bin/chartguard.mjs';

const example = (name) => fileURLToPath(new URL(`../../../examples/${name}`, import.meta.url));

async function run(argv) {
	const out = [];
	const err = [];
	const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, out: out.join('\n'), err: err.join('\n') };
}

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
		[['VIS_BAR_BASELINE', '$.options.scales.y.min']]
	);
	const text = await run(['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json')]);
	assert.match(text.out, /advisory/);
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
	assert.match(out, /warning: \$\.options\.scales\.y\.beginAtZerro .* Did you mean "beginAtZero"\?/);
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
	assert.match(err, /No suitable static object found/);
});

test('unreadable files are input failures', async () => {
	const { code, err } = await run(['validate', '--library', 'echarts', '--file', example('missing.json')]);
	assert.equal(code, 2);
	assert.match(err, /^ChartGuard: Cannot read .*missing\.json/);
});

test('analyze never validates a let config: its initializer may be stale, so it explains instead', async () => {
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-let-source.ts')]);
	assert.equal(code, 0);
	assert.match(out, /^config @ line 1: not validated \(dynamic \/ partial\)/);
	assert.match(out, /config is declared with let and may be reassigned/);
	assert.doesNotMatch(out, /error/);
	const json = JSON.parse(
		(await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-let-source.ts'), '--json'])).out
	);
	assert.equal(json.entries[0].result, undefined);
	assert.deepEqual(
		json.entries[0].notes.map((d) => d.code),
		['CFG_REASSIGNABLE']
	);
});

test('analyze refuses a file with syntax errors instead of validating a recovered tree', async () => {
	const { code, err } = await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-syntax-error.ts')]);
	assert.equal(code, 2);
	assert.match(err, /has syntax errors; nothing read from it is reliable/);
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
