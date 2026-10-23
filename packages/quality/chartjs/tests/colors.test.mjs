import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const colors = (config) =>
	normalize(config).series.items.map(({ color }) =>
		color.known ? `${color.value} ${color.source} ${color.path}` : `? ${color.reason} ${color.path}`
	);
const data = (...datasets) => ({ labels: ['a'], datasets: datasets.map((dataset) => ({ data: [1], ...dataset })) });

test('own colour, then the options for the type, the element and the chart', () => {
	assert.deepEqual(colors({ type: 'bar', data: data({ backgroundColor: '#f00' }) }), [
		'#f00 config $.data.datasets[0].backgroundColor'
	]);
	assert.deepEqual(colors({ type: 'line', data: data({}), options: { datasets: { line: { borderColor: 'navy' } } } }), [
		'navy config $.options.datasets.line.borderColor'
	]);
	assert.deepEqual(
		colors({ type: 'bar', data: data({}), options: { elements: { bar: { backgroundColor: 'blue' } } } }),
		['blue config $.options.elements.bar.backgroundColor']
	);
	assert.deepEqual(colors({ type: 'line', data: data({}), options: { borderColor: 'teal' } }), [
		'teal config $.options.borderColor'
	]);
});

test('without its own colour: Chart.js grey once the config colours anything, else the Colors plugin decides', () => {
	assert.deepEqual(
		colors({ type: 'bar', data: data({ backgroundColor: '#f00' }, {}) })[1],
		'rgba(0,0,0,0.1) default $.data.datasets[1].backgroundColor'
	);
	assert.deepEqual(colors({ type: 'line', data: data({}), options: { elements: { point: { borderColor: 'red' } } } }), [
		'rgba(0,0,0,0.1) default $.data.datasets[0].borderColor'
	]);
	assert.deepEqual(colors({ type: 'bar', data: data({}, {}) }), [
		'? unmodelled $.data.datasets[0].backgroundColor',
		'? unmodelled $.data.datasets[1].backgroundColor'
	]);
});

test('per-point colours, plugin types and getters are not modelled', () => {
	assert.deepEqual(colors({ type: 'bar', data: data({ backgroundColor: ['#f00', '#0f0'] }) }), [
		'? unmodelled $.data.datasets[0].backgroundColor'
	]);
	assert.deepEqual(colors({ type: 'pie', data: data({}) }), ['? unmodelled $.data.datasets[0].backgroundColor']);
	const hidden = Object.defineProperty({ data: [1] }, 'backgroundColor', { get: () => '#f00' });
	assert.deepEqual(colors({ type: 'bar', data: { datasets: [hidden, { data: [1] }] } }), [
		'? accessor $.data.datasets[0].backgroundColor',
		'? accessor $.data.datasets[1].backgroundColor'
	]);
});

test('shades and background: a colour is the same in both schemes; the canvas background is the page', () => {
	const chart = normalize({ type: 'bar', data: data({ backgroundColor: '#f00' }) });
	assert.deepEqual(
		[chart.series.items[0].shades.value.light.value, chart.series.items[0].shades.value.dark.value],
		['#f00', '#f00']
	);
	assert.deepEqual(chart.background, { known: false, path: '$', reason: 'page' });
});

test('with the Colors plugin forcing its palette, no dataset colour is known: whether it is registered is not in the config (K7)', () => {
	const twice = (plugins) => ({
		type: 'bar',
		data: {
			labels: ['a'],
			datasets: [
				{ label: 'A', data: [1], backgroundColor: '#ff0000' },
				{ label: 'B', data: [2], backgroundColor: '#f00' }
			]
		},
		options: { plugins }
	});
	const seriesColors = (config) =>
		normalize(config).series.items.map(({ color }) => (color.known ? color.value : `? ${color.reason}`));
	assert.deepEqual(seriesColors(twice({})), ['#ff0000', '#f00']);
	assert.deepEqual(seriesColors(twice({ colors: { forceOverride: true } })), ['? unmodelled', '? unmodelled']);
	// Turned off, the plugin forces nothing.
	assert.deepEqual(seriesColors(twice({ colors: { forceOverride: true, enabled: false } })), ['#ff0000', '#f00']);
	assert.deepEqual(
		seriesColors(twice({ colors: Object.defineProperty({}, 'forceOverride', { get: () => true, enumerable: true }) })),
		['? accessor', '? accessor']
	);
	const same = (config) => analyze(config).diagnostics.filter(({ code }) => code === 'VIS_SAME_COLOR_SERIES').length;
	assert.equal(same(twice({})), 1);
	assert.equal(same(twice({ colors: { forceOverride: true } })), 0);
});
