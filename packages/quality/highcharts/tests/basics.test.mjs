import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

test('returns an advisory report for the library', () => assert.equal(analyze({}).library, 'highcharts'));

test('reads chart kind from chart.type; wrongly typed facts stay unknown', () =>
	assert.deepEqual(normalize({ chart: { type: 'bar' }, yAxis: { min: 'x' }, title: { text: 'T' } }), {
		kind: { value: 'bar', path: '$.chart.type' },
		yMin: undefined,
		title: { value: 'T', path: '$.title.text' }
	}));

test('findings point at the Highcharts option that triggered them', () =>
	assert.deepEqual(
		analyze({ chart: { type: 'bar' }, yAxis: { min: 2 }, title: { text: '' } }).diagnostics.map((d) => d.path),
		['$.yAxis.min', '$.title.text']
	));
