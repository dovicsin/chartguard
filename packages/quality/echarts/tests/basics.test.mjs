import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';
test('returns structured result', () => assert.equal(analyze({}).library, 'echarts'));

test('reads chart kind from the first series', () =>
	assert.deepEqual(normalize({ series: [{ type: 'bar' }], yAxis: { min: 3 } }), { kind: 'bar', yMin: 3 }));
