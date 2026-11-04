import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

/** Legend entries (CG-05-04 part 9): echarts lists only named series, so it draws no placeholder entry. */
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const entry = (option, index = 0) => {
	const { text, shown } = normalize(option).series.items[index].legend;
	return [brief(text), brief(shown)];
};
const bars = (series = {}, extra = {}) => ({
	xAxis: { type: 'category', data: ['a'] },
	yAxis: {},
	series: [{ type: 'bar', data: [1], ...series }],
	...extra
});
const legendCodes = (option) =>
	analyze(option)
		.diagnostics.filter(({ code }) => code === 'VIS_LEGEND_PLACEHOLDER')
		.map(({ code, path }) => `${code} ${path}`);

test('a named series is listed in every legend without data; without a legend there is no entry', () => {
	assert.deepEqual(entry(bars({ name: 'Sales' }, { legend: {} })), [
		'Sales config $.series[0].name',
		'true default $.legend.show'
	]);
	assert.deepEqual(entry(bars({ name: 'Sales' }))[1], 'false config $.legend');
	assert.deepEqual(entry(bars({ name: 'Sales' }, { legend: { show: false } }))[1], 'false config $.legend.show');
	assert.deepEqual(
		entry(bars({ name: 'Sales' }, { legend: [{ show: false }, {}] }))[1],
		'true default $.legend[1].show'
	);
});

test('an unnamed series is named "series\\0<index>" and never listed by default: no finding', () => {
	const [text, shown] = entry(bars({}, { legend: {} }));
	assert.equal(text, 'series\u00000 default $.series[0].name');
	assert.equal(shown, 'false default $.series[0].name');
	assert.deepEqual(legendCodes(bars({}, { legend: {} })), []);
});

test('legend data, a formatter, data dimensions and getters leave the entry unknown', () => {
	assert.equal(entry(bars({}, { legend: { data: ['series\u00000'] } }))[1], '? unmodelled $.legend.data');
	assert.equal(
		entry(bars({ name: 'S' }, { legend: { formatter: (name) => name } }))[0],
		'? dynamic $.legend.formatter'
	);
	assert.equal(entry(bars({ name: 'S' }, { legend: { formatter: '{name}!' } }))[0], '? unmodelled $.legend.formatter');
	assert.equal(entry(bars({ encode: { y: 1 } }, { legend: {} }))[0], '? unmodelled $.series[0].name');
	assert.equal(
		entry({ dataset: { source: [['x', 'S']] }, legend: {}, series: [{ type: 'bar' }] })[1],
		'? unmodelled $.series[0].name'
	);
	const legend = {};
	Object.defineProperty(legend, 'show', { get: () => true, enumerable: true });
	assert.equal(entry(bars({ name: 'S' }, { legend }))[1], '? accessor $.legend.show');
	assert.equal(entry(bars({ name: 'S', type: 'pie' }, { legend: {} }))[1], '? unmodelled $.series[0].type');
});
