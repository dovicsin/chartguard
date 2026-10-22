import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize } from '../dist/index.js';

const colors = (config) =>
	normalize(config).series.items.map(({ color }) =>
		color.known ? `${color.value} ${color.source} ${color.path}` : `? ${color.reason} ${color.path}`
	);

test('the ten chart colours (CSS variables), the counter moving only for series that take one', () => {
	const drawn = colors({ series: Array.from({ length: 11 }, () => ({})) });
	assert.equal(drawn[0], 'var(--highcharts-color-0) default $.series[0].color');
	assert.equal(drawn[10], 'var(--highcharts-color-0) default $.series[10].color');
	assert.deepEqual(
		colors({ colors: ['#111', '#222'], series: [{ color: '#f00' }, {}, { colorIndex: 1 }, {}, { type: 'pie' }, {}] }),
		[
			'#f00 config $.series[0].color',
			'#111 config $.colors[0]',
			'#222 config $.colors[1]',
			'#222 config $.colors[1]',
			'? unmodelled $.series[4].color',
			'#111 config $.colors[0]'
		]
	);
});

test('colour from plotOptions, colorByPoint, styled mode and out-of-range colorIndex', () => {
	assert.deepEqual(
		colors({ plotOptions: { column: { color: '#0f0' } }, series: [{ type: 'column' }, { type: 'line' }] }),
		['#0f0 config $.plotOptions.column.color', 'var(--highcharts-color-0) default $.series[1].color']
	);
	assert.deepEqual(colors({ series: [{ type: 'column', colorByPoint: true }, {}] }), [
		'? unmodelled $.series[0].color',
		'var(--highcharts-color-0) default $.series[1].color'
	]);
	assert.deepEqual(colors({ chart: { styledMode: true }, series: [{}] }), ['? unmodelled $.series[0].color']);
	assert.deepEqual(colors({ colors: ['#111'], series: [{ colorIndex: 3 }] }), ['? unmodelled $.series[0].color']);
});
