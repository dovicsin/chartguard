import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

/** Legend entries (CG-05-04 part 9): Highcharts names an unnamed series "Series 1", "Series 2" … and lists it. */
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const entry = (config, index = 0) => {
	const { text, shown } = normalize(config).series.items[index].legend;
	return [brief(text), brief(shown)];
};
const legendCodes = (config) =>
	analyze(config)
		.diagnostics.filter(({ code }) => code === 'VIS_LEGEND_PLACEHOLDER')
		.map(({ code, path }) => `${code} ${path}`);

test('an unnamed series is drawn as "Series" and its place in the chart; a name of its own, or null, decide', () => {
	const config = {
		series: [
			{ type: 'column', data: [1] },
			{ name: 'Sales', data: [1] },
			{ name: null, data: [1] }
		]
	};
	assert.deepEqual(entry(config), ['Series 1 default $.series[0].name', 'true default $.series[0].showInLegend']);
	assert.deepEqual(entry(config, 1)[0], 'Sales config $.series[1].name');
	assert.deepEqual(entry(config, 2)[0], 'Series 3 default $.series[2].name');
	assert.deepEqual(legendCodes(config), [
		'VIS_LEGEND_PLACEHOLDER $.series[0].name',
		'VIS_LEGEND_PLACEHOLDER $.series[2].name'
	]);
});

test('no entry: the legend off, showInLegend false in any scope, a linked series; a pie lists its points', () => {
	const column = { type: 'column', data: [1] };
	assert.equal(entry({ legend: { enabled: false }, series: [column] })[1], 'false config $.legend.enabled');
	assert.equal(entry({ series: [{ ...column, showInLegend: false }] })[1], 'false config $.series[0].showInLegend');
	assert.equal(
		entry({ plotOptions: { series: { showInLegend: false } }, series: [column] })[1],
		'false config $.plotOptions.series.showInLegend'
	);
	assert.equal(
		entry({ series: [column, { ...column, linkedTo: ':previous' }] }, 1)[1],
		'false default $.series[1].showInLegend'
	);
	assert.equal(entry({ series: [{ type: 'pie', data: [1] }] })[1], '? inapplicable $.series[0]');
	assert.equal(entry({ series: [{ ...column, legendType: 'point' }] })[1], '? inapplicable $.series[0].legendType');
	assert.deepEqual(legendCodes({ legend: { enabled: false }, series: [column] }), []);
});

test('what the config cannot show leaves the entry unknown: formats, language, reordering, mapping, colour axes, getters', () => {
	const column = { type: 'column', data: [1] };
	assert.equal(
		entry({ legend: { labelFormatter: () => 'x' }, series: [column] })[0],
		'? dynamic $.legend.labelFormatter'
	);
	assert.equal(entry({ legend: { labelFormat: '{name}' }, series: [column] })[0], '? unmodelled $.legend.labelFormat');
	assert.equal(
		entry({ lang: { seriesName: 'Reihe {add index 1}' }, series: [column] })[0],
		'? unmodelled $.series[0].name'
	);
	assert.equal(entry({ series: [column, { ...column, index: 0 }] })[0], '? unmodelled $.series[0].name');
	assert.equal(entry({ series: [{ ...column, dataMapping: { y: 'v' } }] })[0], '? unmodelled $.series[0].name');
	assert.equal(entry({ colorAxis: {}, series: [column] })[1], '? unmodelled $.colorAxis');
	assert.equal(entry({ series: [{ type: 'arearange', data: [[1, 2]] }] })[1], '? unmodelled $.series[0]');
	const hidden = { type: 'column', data: [1] };
	Object.defineProperty(hidden, 'name', { get: () => 'Sales', enumerable: true });
	assert.equal(entry({ series: [hidden] })[0], '? accessor $.series[0].name');
	const legend = {};
	Object.defineProperty(legend, 'enabled', { get: () => false, enumerable: true });
	assert.equal(entry({ legend, series: [column] })[1], '? accessor $.legend.enabled');
	assert.deepEqual(legendCodes({ series: [hidden] }), []);
});
