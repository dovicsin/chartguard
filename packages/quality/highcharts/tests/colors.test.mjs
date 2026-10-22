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

test('shades: palette variables resolved per scheme (light, dark overrides, palette colors); backgrounds; colorScheme and injectCSS are not modelled', () => {
	const shade = (fact) =>
		fact.known ? `${String(fact.value.light?.value)} / ${String(fact.value.dark?.value)}` : `? ${fact.reason}`;
	const chart = normalize({ series: [{}, {}, { color: '#000' }] });
	assert.deepEqual(
		chart.series.items.map(({ shades }) => shade(shades)),
		['#2caffe / #2caffe', '#544fc5 / #00e272', '#000 / #000']
	);
	assert.equal(shade(chart.background), '#ffffff / #141414');
	const palette = normalize({
		palette: { colors: ['#111'], light: { colors: ['#222'], backgroundColor: '#eee' } },
		series: [{}]
	});
	assert.equal(shade(palette.series.items[0].shades), '#222 / #111');
	assert.equal(shade(palette.background), '#eee / #141414');
	assert.equal(
		shade(normalize({ chart: { plotBackgroundColor: '#ccc', backgroundColor: '#000' }, series: [{}] }).background),
		'#ccc / #ccc'
	);
	assert.equal(
		shade(normalize({ palette: { colorScheme: 'dark' }, series: [{}] }).series.items[0].shades),
		'? unmodelled'
	);
	assert.equal(shade(normalize({ palette: { injectCSS: false }, series: [{}] }).background), '? unmodelled');
});
