import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

/** Legend entries (CG-05-04 part 9): the text Chart.js draws for each dataset, and whether it draws one. */
const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const entry = (config, index = 0) => {
	const { text, shown } = normalize(config).series.items[index].legend;
	return [brief(text), brief(shown)];
};
const bars = (dataset = {}, options = {}, type = 'bar') => ({
	type,
	data: { labels: ['a'], datasets: [{ data: [1], ...dataset }] },
	options
});
const legendCodes = (config) =>
	analyze(config)
		.diagnostics.filter(({ code }) => code === 'VIS_LEGEND_PLACEHOLDER')
		.map(({ code, path }) => `${code} ${path}`);

test('a dataset without a label is drawn as "undefined" in a legend displayed by default', () => {
	assert.deepEqual(entry(bars()), [
		'undefined default $.data.datasets[0].label',
		'true default $.options.plugins.legend.display'
	]);
	assert.deepEqual(entry(bars({ label: 'Sales' })), [
		'Sales config $.data.datasets[0].label',
		'true default $.options.plugins.legend.display'
	]);
	assert.deepEqual(legendCodes(bars()), ['VIS_LEGEND_PLACEHOLDER $.data.datasets[0].label']);
	assert.deepEqual(legendCodes(bars({ label: 'Sales' })), []);
	assert.deepEqual(legendCodes(bars({ label: '' })), []);
});

test('a legend turned off, or the plugins turned off, draws no entry', () => {
	assert.deepEqual(
		entry(bars({}, { plugins: { legend: { display: false } } }))[1],
		'false config $.options.plugins.legend.display'
	);
	assert.deepEqual(entry(bars({}, { plugins: { legend: false } }))[1], 'false config $.options.plugins.legend');
	assert.deepEqual(entry(bars({}, { plugins: false }))[1], 'false config $.options.plugins');
	assert.deepEqual(legendCodes(bars({}, { plugins: { legend: { display: false } } })), []);
});

test('callbacks that make or filter the entries, getters and scriptable switches leave them unknown', () => {
	const labels = (extra) => entry(bars({}, { plugins: { legend: { labels: extra } } }))[1];
	assert.equal(labels({ filter: () => true }), '? dynamic $.options.plugins.legend.labels.filter');
	assert.equal(labels({ generateLabels: () => [] }), '? dynamic $.options.plugins.legend.labels.generateLabels');
	assert.equal(
		entry(bars({}, { plugins: { legend: { display: () => true } } }))[1],
		'? dynamic $.options.plugins.legend.display'
	);
	const hidden = { data: [1] };
	Object.defineProperty(hidden, 'label', { get: () => 'Sales', enumerable: true });
	assert.equal(entry({ type: 'bar', data: { datasets: [hidden] } })[0], '? accessor $.data.datasets[0].label');
	assert.equal(entry({ data: { datasets: [{ data: [1] }] } })[1], '? unset $.type');
	assert.deepEqual(legendCodes(bars({}, { plugins: { legend: { labels: { filter: () => true } } } })), []);
});

test('a pie, doughnut or polar area chart lists its labels, not its datasets; a pie dataset in another chart is listed', () => {
	for (const type of ['pie', 'doughnut', 'polarArea'])
		assert.equal(entry(bars({}, {}, type))[1], '? inapplicable $.type', type);
	assert.equal(entry(bars({ type: 'pie' }, {}, 'line'))[1], 'true default $.options.plugins.legend.display');
	assert.deepEqual(legendCodes(bars({}, {}, 'pie')), []);
});
