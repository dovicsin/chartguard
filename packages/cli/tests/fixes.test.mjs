import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { validate } from '@chartguard/config-echarts';
import { applyFix } from '@chartguard/core';

import { run, sourceProject } from './helpers.mjs';

/** Fixes in the CLI's text report (CG-05-06): a rename the runtime performs itself, under its finding. */
test('validate prints a behaviour-preserving rename under its finding; applied, the deprecation is gone', async (t) => {
	const option = {
		xAxis: { type: 'category', data: ['a'] },
		yAxis: {},
		series: [{ type: 'line', data: [1], clipOverflow: true }]
	};
	const root = sourceProject(t, { 'option.json': JSON.stringify(option) });
	const { code, out } = await run(['validate', '--library', 'echarts', '--file', join(root, 'option.json')]);
	assert.equal(code, 0);
	assert.match(
		out,
		/WARNING CFG_DEPRECATED \$\.series\[0\]\.clipOverflow: .*\n {4}FIX rename to clip \(the runtime reads it so already\)/
	);
	const [deprecated] = validate(option).diagnostics;
	const renamed = applyFix(option, deprecated.fix, deprecated.path);
	assert.deepEqual(renamed.series[0], { type: 'line', data: [1], clip: true });
	assert.deepEqual(validate(renamed).diagnostics, []);
	assert.equal(option.series[0].clipOverflow, true);
});
