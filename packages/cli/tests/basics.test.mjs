import assert from 'node:assert/strict';
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

test('quality json output is tagged with its mode', async () => {
	const argv = ['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json'), '--json'];
	const { code, out } = await run(argv);
	const report = JSON.parse(out);
	assert.equal(code, 0);
	assert.equal(report.mode, 'quality');
	assert.ok(report.diagnostics.some((d) => d.code === 'VIS_BAR_BASELINE'));
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
		report.entries.map((entry) => entry.name),
		['config']
	);
});

test('analyze without a matching variable fails with an explanation', async () => {
	const argv = ['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts'), '--name', 'missing'];
	const { code, err } = await run(argv);
	assert.equal(code, 2);
	assert.match(err, /No suitable static object found/);
});

test('unreadable files are invocation failures', async () => {
	const { code, err } = await run(['validate', '--library', 'echarts', '--file', example('missing.json')]);
	assert.equal(code, 2);
	assert.match(err, /^ChartGuard: /);
});
