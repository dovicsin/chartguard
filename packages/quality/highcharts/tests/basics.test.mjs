import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';
test('returns structured result', () => assert.equal(analyze({}).library, 'highcharts'));

test('reads chart kind from chart.type', () =>
	assert.deepEqual(normalize({ chart: { type: 'bar' }, yAxis: { min: 'x' } }), { kind: 'bar', yMin: undefined }));
