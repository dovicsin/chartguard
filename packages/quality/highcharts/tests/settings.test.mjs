import assert from 'node:assert/strict';
import test from 'node:test';

import { QualityOptionsError } from '@chartguard/quality-core';

import { analyze } from '../dist/index.js';

/** The adapter passes the caller's options to the review (CG-05-05). */
const CONFIG = {
	chart: { type: 'column', backgroundColor: 'transparent' },
	yAxis: { min: 50 },
	series: [{ data: [60], color: '#eeeeee' }]
};
const codes = (report) => report.diagnostics.map(({ code, path }) => `${code} ${path}`);

test('options reach the review: a rule turned off, a finding ignored, the page background declared', () => {
	assert.ok(codes(analyze(CONFIG)).includes('VIS_BAR_BASELINE $.yAxis.min'));
	assert.ok(!codes(analyze(CONFIG, { rules: { 'bar-baseline': 'off' } })).includes('VIS_BAR_BASELINE $.yAxis.min'));
	const ignored = analyze(CONFIG, { rules: { 'bar-baseline': { ignore: [{ path: '$.yAxis.min', reason: 'r' }] } } });
	assert.deepEqual(
		ignored.suppressed.map(({ diagnostic }) => diagnostic.code),
		['VIS_BAR_BASELINE']
	);
	// The chart draws no background: only a declared page lets the light series be measured.
	assert.ok(!codes(analyze(CONFIG)).includes('VIS_LOW_CONTRAST_SERIES $.series[0].color'));
	assert.ok(
		codes(analyze(CONFIG, { context: { background: '#ffffff' } })).includes('VIS_LOW_CONTRAST_SERIES $.series[0].color')
	);
	assert.throws(() => analyze(CONFIG, { rules: { 'bar-baseline': 'error' } }), QualityOptionsError);
});
