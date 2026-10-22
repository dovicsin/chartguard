import assert from 'node:assert/strict';
import test from 'node:test';

import { normalize } from '../dist/index.js';

const colors = (option) =>
	normalize(option).series.items.map(({ color }) =>
		color.known ? `${color.value} ${color.source} ${color.path}` : `? ${color.reason} ${color.path}`
	);
const lines = (count, extra = () => ({})) =>
	Array.from({ length: count }, (_, index) => ({ type: 'line', ...extra(index) }));

test('the theme palette, one colour per series in order, wrapping around', () => {
	const drawn = colors({ series: lines(10) });
	assert.equal(drawn[0], '#5070dd default $.series[0].itemStyle.color');
	assert.equal(drawn[9], '#5070dd default $.series[9].itemStyle.color');
});

test('own colours do not take a palette colour; a repeated name reuses its colour; series and global palettes', () => {
	assert.deepEqual(colors({ series: [{ type: 'bar', itemStyle: { color: '#123' } }, { type: 'bar' }] }), [
		'#123 config $.series[0].itemStyle.color',
		'#5070dd default $.series[1].itemStyle.color'
	]);
	assert.deepEqual(colors({ series: lines(3, (index) => ({ name: index < 2 ? 'A' : 'B' })) }), [
		'#5070dd default $.series[0].itemStyle.color',
		'#5070dd default $.series[1].itemStyle.color',
		'#b6d634 default $.series[2].itemStyle.color'
	]);
	assert.deepEqual(colors({ series: [{ type: 'bar', color: ['#abc'] }] }), ['#abc config $.series[0].color[0]']);
	assert.deepEqual(colors({ color: ['#111', '#222'], series: lines(3) }), [
		'#111 config $.color[0]',
		'#222 config $.color[1]',
		'#111 config $.color[0]'
	]);
});

test('a line repainted by lineStyle, functions, pies and unreadable series are not modelled; the palette keeps its place', () => {
	assert.deepEqual(colors({ series: [{ type: 'line', lineStyle: { color: '#123' } }, { type: 'line' }] }), [
		'? unmodelled $.series[0].lineStyle.color',
		'#b6d634 default $.series[1].itemStyle.color'
	]);
	assert.deepEqual(colors({ series: [{ type: 'bar', itemStyle: { color: () => '#f00' } }, { type: 'bar' }] }), [
		'? dynamic $.series[0].itemStyle.color',
		'#b6d634 default $.series[1].itemStyle.color'
	]);
	assert.deepEqual(colors({ series: [{ type: 'pie' }, { type: 'bar' }] }), [
		'? unmodelled $.series[0].itemStyle.color',
		'#b6d634 default $.series[1].itemStyle.color'
	]);
	const hidden = Object.defineProperty({ type: 'bar' }, 'name', { get: () => 'x' });
	assert.deepEqual(colors({ series: [hidden, { type: 'bar' }] }), [
		'? unmodelled $.series[0].itemStyle.color',
		'? unmodelled $.series[1].itemStyle.color'
	]);
});

test('background: only an opaque backgroundColor; without one, or translucent, or with a grid background, the page decides', () => {
	const background = (option) => {
		const fact = normalize(option).background;
		return fact.known ? `${fact.value.light.value} / ${fact.value.dark.value}` : `? ${fact.reason}`;
	};
	assert.equal(background({ backgroundColor: '#fff' }), '#fff / #fff');
	// Without a background, or with a transparent one, the page shows through.
	assert.equal(background({}), '? page');
	assert.equal(background({ backgroundColor: 'transparent' }), '? page');
	assert.equal(background({ backgroundColor: 'rgba(255, 255, 255, 0)' }), '? page');
	assert.equal(background({ backgroundColor: 'rgba(255, 255, 255, 0.5)' }), '? unmodelled');
	assert.equal(background({ backgroundColor: '#fff', grid: { show: true } }), '? unmodelled');
	assert.equal(
		normalize({ series: [{ type: 'bar', itemStyle: { color: '#123' } }] }).series.items[0].shades.value.dark.value,
		'#123'
	);
});
