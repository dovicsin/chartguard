import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';
test('rejects nonobject root', () => assert.equal(validate(42).status, 'invalid'));

test('valid 13.x union forms are not rejected', () => {
	const config = {
		chart: { type: 'line', height: '50%', width: null },
		xAxis: [{ categories: ['a', 'b'] }, { opposite: true }],
		yAxis: { min: null, max: '2026-01-01', title: { text: null } },
		series: [{ type: 'line', data: [1, 2], color: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [] } }]
	};
	const result = validate(config);
	assert.equal(result.valid, true);
	assert.deepEqual(result.diagnostics, []);
});

test('closed primitive fields are still confirmed errors', () => {
	const result = validate({ credits: { enabled: 'false' }, series: [{ name: 7 }] });
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.path}`),
		['CFG_TYPE $.credits.enabled', 'CFG_TYPE $.series[0].name']
	);
});

test('schema version tracks the 13.x line', () => assert.match(validate({}).schemaVersion, /^13\.x/));
