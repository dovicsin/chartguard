import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

test('returns an advisory report for the library', () => {
	const report = analyze({});
	assert.equal(report.library, 'chartjs');
	assert.deepEqual(report.diagnostics, []);
});

test('reads chart kind, baseline and title from the Chart.js shape with their paths', () =>
	assert.deepEqual(
		normalize({ type: 'bar', options: { scales: { y: { min: 10 } }, plugins: { title: { text: '' } } } }),
		{
			kind: { value: 'bar', path: '$.type' },
			yMin: { value: 10, path: '$.options.scales.y.min' },
			title: { value: '', path: '$.options.plugins.title.text' }
		}
	));

test('findings point at the Chart.js option that triggered them', () => {
	const report = analyze({ type: 'bar', options: { scales: { y: { min: 10 } }, plugins: { title: { text: ' ' } } } });
	assert.deepEqual(
		report.diagnostics.map((d) => [d.code, d.path]),
		[
			['VIS_BAR_BASELINE', '$.options.scales.y.min'],
			['VIS_EMPTY_TITLE', '$.options.plugins.title.text']
		]
	);
});
