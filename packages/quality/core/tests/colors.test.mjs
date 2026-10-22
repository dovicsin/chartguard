import assert from 'node:assert/strict';
import test from 'node:test';

import { colorKey, review } from '../dist/index.js';

/** The colour facts and rule (CG-05-04 part 4). */
test('colorKey: hex and rgb() notations of one colour share a key; other forms keep their own text', () => {
	const red = ['#f00', '#FF0000', '#ff0000ff', 'rgb(255, 0, 0)', 'rgba(255,0,0,1)', 'rgb(255 0 0 / 100%)'];
	assert.equal(new Set(red.map(colorKey)).size, 1);
	assert.notEqual(colorKey('#ff000080'), colorKey('#ff0000'));
	assert.equal(colorKey(' Red '), 'red');
	assert.equal(colorKey('var(--highcharts-color-0)'), 'var(--highcharts-color-0)');
	assert.notEqual(colorKey('red'), colorKey('#f00'));
});

const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unset') => ({ known: false, path, reason });
const series = (kind, color, index) => ({
	path: `$.s${String(index)}`,
	type: fact(kind, '$.t'),
	kind: fact(kind, '$.t'),
	name: none('$.n'),
	valueAxis: none('$.a'),
	orientation: none('$.o'),
	color,
	values: none('$.v')
});
const chart = (items) => ({
	library: 't',
	title: { text: fact('T', '$.title'), shown: none('$.shown') },
	series: { known: true, path: '$.series', items: items.map((item, index) => series(...item, index)) },
	axes: [],
	background: none('$.background'),
	motion: { endless: none('$.endless'), longest: none('$.longest') },
	access: { dataDescribed: none('$.access'), keyboard: none('$.keyboard') }
});
const codes = (semantics) => review(semantics).diagnostics.map((d) => `${d.code} ${d.path}`);

test('same colour: each later cartesian series in a colour an earlier one has', () => {
	assert.deepEqual(
		codes(
			chart([
				['bar', fact('#369', '$.c0')],
				['line', fact('rgb(51,102,153)', '$.c1')],
				['bar', fact('#336699', '$.c2', 'default')],
				['bar', fact('#000', '$.c3')]
			])
		),
		['VIS_SAME_COLOR_SERIES $.c1', 'VIS_SAME_COLOR_SERIES $.c2']
	);
	// Unknown colours and pies are not compared.
	assert.deepEqual(
		codes(
			chart([
				['bar', none('$.c0', 'unmodelled')],
				['bar', none('$.c1', 'unmodelled')]
			])
		),
		[]
	);
	assert.deepEqual(
		codes(
			chart([
				['pie', fact('#369', '$.c0')],
				['pie', fact('#369', '$.c1')]
			])
		),
		[]
	);
});

test('contrast ratio: WCAG luminance; a translucent colour is judged over the background; a translucent background is unknown', async () => {
	const { contrastRatio } = await import('../dist/index.js');
	assert.equal(contrastRatio('#000', '#fff')?.toFixed(2), '21.00');
	assert.equal(contrastRatio('#767676', '#ffffff')?.toFixed(2), '4.54');
	assert.equal(contrastRatio('rgba(0, 0, 0, 0.1)', '#ffffff')?.toFixed(2), '1.25');
	assert.equal(contrastRatio('#000', 'rgba(255, 255, 255, 0.5)'), undefined);
	assert.equal(contrastRatio('red', '#fff'), undefined);
});

test('low contrast: each cartesian series below 3:1 in a scheme where both shades are known', () => {
	const shades = (light, dark) => fact({ light: light && fact(light, '$.l'), dark: dark && fact(dark, '$.d') }, '$.c');
	const contrastChart = (items, background) => ({
		...chart([]),
		series: { known: true, path: '$.series', items },
		background
	});
	const item = (kind, shade, index) => ({ ...series(kind, none('$.c'), index), shades: shade });
	const white = fact({ light: fact('#ffffff', '$.bl'), dark: fact('#141414', '$.bd') }, '$.bg');
	assert.deepEqual(codes(contrastChart([item('bar', shades('#2caffe', '#2caffe'), 0)], white)), [
		'VIS_LOW_CONTRAST_SERIES $.c'
	]);
	assert.match(
		review(contrastChart([item('bar', shades('#2caffe', '#2caffe'), 0)], white)).diagnostics[0].message,
		/2\.42:1 in the light scheme/
	);
	assert.deepEqual(codes(contrastChart([item('line', shades('#544fc5', '#00e272'), 0)], white)), []);
	assert.deepEqual(codes(contrastChart([item('pie', shades('#eeeeee', '#eeeeee'), 0)], white)), []);
	assert.deepEqual(
		codes(contrastChart([item('bar', shades('#eeeeee', undefined), 0)], none('$.bg', 'unmodelled'))),
		[]
	);
});
