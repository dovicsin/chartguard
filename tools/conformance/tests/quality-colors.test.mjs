import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { colorKey } from '../../../packages/quality/core/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { normalize as normalizeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/**
 * The colour facts against the runtimes (CG-05-04 part 4): every known series colour is the colour the
 * pinned runtime draws the series in. Cases exercise each assignment rule; the rules contract adds its charts.
 */
const LABELS = ['a', 'b'];
const lines = (count, extra = () => ({})) => Array.from({ length: count }, (_, index) => ({ type: 'line', data: [index, index + 1], ...extra(index) }));

const CHARTJS = [
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [1, 2], backgroundColor: '#f00' }, { data: [2, 3] }] } },
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [1, 2] }, { data: [2, 3] }] }, options: { elements: { bar: { backgroundColor: 'blue' } } } },
	{ type: 'line', data: { labels: LABELS, datasets: [{ data: [1, 2] }, { data: [2, 3], borderColor: 'green' }] }, options: { datasets: { line: { borderColor: 'navy' } } } },
	{ type: 'line', data: { labels: LABELS, datasets: [{ data: [1, 2] }, { type: 'bar', data: [2, 3] }] }, options: { backgroundColor: 'rgb(1, 2, 3)' } }
];

const ECHARTS = [
	{ xAxis: { data: LABELS }, yAxis: {}, series: lines(11) },
	{ xAxis: { data: LABELS }, yAxis: {}, series: lines(4, (index) => ({ name: index < 2 ? 'same' : `s${String(index)}` })) },
	{ xAxis: { data: LABELS }, yAxis: {}, series: [{ type: 'line', lineStyle: { color: '#123456' }, data: [1, 2] }, { type: 'bar', itemStyle: { color: '#654321' }, data: [1, 2] }, { type: 'bar', data: [1, 2] }] },
	{ color: ['#111111', '#222222'], xAxis: { data: LABELS }, yAxis: {}, series: lines(3) },
	{ xAxis: { data: LABELS }, yAxis: {}, series: [{ type: 'bar', color: ['#abcdef'], data: [1, 2] }, { type: 'bar', data: [1, 2] }] },
	{ xAxis: { data: LABELS }, yAxis: {}, series: [{ type: 'bar', data: [1, 2] }, { type: 'pie', center: ['80%', '20%'], radius: 10, data: [1, 2] }, { type: 'line', data: [1, 2] }] }
];

const HIGHCHARTS = [
	{ series: lines(11) },
	{ colors: ['#111111', '#222222'], series: [{ color: '#ff0000', data: [1] }, { data: [1] }, { colorIndex: 0, data: [1] }, { data: [1] }, { type: 'pie', data: [1], center: ['80%', '20%'], size: 20 }, { data: [1] }] },
	{ plotOptions: { column: { color: '#00ff00' } }, series: [{ type: 'column', data: [1] }, { type: 'line', data: [1] }] }
];

const contract = (library) => RULES_CONTRACT.flatMap((entry) => (entry[library] === undefined ? [] : [entry[library].config]));

function agree(semantics, drawnBy, where) {
	semantics.series.items.forEach(({ color }, index) => {
		if (!color.known) return;
		const drawn = drawnBy(index);
		assert.equal(typeof drawn, 'string', `${where} series ${String(index)}: drawn ${JSON.stringify(drawn)}`);
		assert.equal(colorKey(color.value), colorKey(drawn), `${where} series ${String(index)}`);
	});
}

test('Chart.js: every known series colour is the colour the dataset is drawn in', () => {
	for (const config of [...CHARTJS, ...contract('chartjs')]) {
		const chart = createChartjs(copyPlain(config));
		try {
			agree(
				normalizeChartjs(config),
				(index) => {
					const meta = chart.getDatasetMeta(index);
					return meta.type === 'line' ? meta.dataset.options.borderColor : meta.data[0].options.backgroundColor;
				},
				JSON.stringify(config)
			);
		} finally {
			chart.destroy();
		}
	}
});

test('ECharts: every known series colour is the colour the series style task assigns', () => {
	for (const option of [...ECHARTS, ...contract('echarts')]) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			const models = chart.getModel().getSeries();
			agree(
				normalizeEcharts(option),
				(index) => {
					const data = models[index].getData();
					return data.getVisual('style')[data.getVisual('drawType')];
				},
				JSON.stringify(option)
			);
		} finally {
			chart.dispose();
		}
	}
});

const browser = { skip: browserSkipReason() ?? false };

test('Highcharts: every known series colour is the colour the series takes', browser, async () => {
	const configs = [...HIGHCHARTS, ...contract('highcharts')];
	const outcomes = await runHighcharts(configs.map((config) => ({ config })));
	configs.forEach((config, position) => agree(normalizeHighcharts(config), (index) => outcomes[position].observed.series[index].color, JSON.stringify(config)));
});
