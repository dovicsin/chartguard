import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';
test('returns structured result', () => assert.equal(analyze({}).library, 'chartjs'));

test('reads chart kind and baseline from the Chart.js shape', () =>
	assert.deepEqual(normalize({ type: 'bar', options: { scales: { y: { min: 10 } } } }), { kind: 'bar', yMin: 10 }));
