import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

test('returns an advisory report for the library', () => assert.equal(analyze({}).library, 'echarts'));

test('reads chart kind from the first series, baseline and title with their paths', () =>
	assert.deepEqual(normalize({ series: [{ type: 'bar' }], yAxis: { min: 3 }, title: { text: 'T' } }), {
		kind: { value: 'bar', path: '$.series[0].type' },
		yMin: { value: 3, path: '$.yAxis.min' },
		title: { value: 'T', path: '$.title.text' }
	}));

test('array-valued axes and titles stay unknown instead of guessing an entry', () =>
	assert.deepEqual(normalize({ series: [{ type: 'bar' }], yAxis: [{ min: 3 }], title: [{ text: '' }] }), {
		kind: { value: 'bar', path: '$.series[0].type' },
		yMin: undefined,
		title: undefined
	}));

test('findings point at the ECharts option that triggered them', () =>
	assert.deepEqual(
		analyze({ series: [{ type: 'bar' }], yAxis: { min: 3 } }).diagnostics.map((d) => d.path),
		['$.yAxis.min']
	));
