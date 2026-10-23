import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { normalize as normalizeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/**
 * Bar bases and units against the runtimes (CG-05-04 part 8): a known `base` is where the runtime
 * draws the bars from; a known `unit` is in every drawn tick label, and an empty one leaves them plain
 * numbers.
 */

const LABELS = ['a', 'b'];
const CHARTJS_BASES = [
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70], base: 20 }, { data: [5, 6] }] } },
	{
		type: 'bar',
		data: { labels: LABELS, datasets: [{ data: [60, 70] }] },
		options: { datasets: { bar: { base: 15 } }, base: 3 }
	},
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70] }] }, options: { base: -5 } },
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70] }] }, options: { indexAxis: 'y', base: 10 } }
];

test('Chart.js: a known base is the value its bars are drawn from', () => {
	for (const config of [
		...CHARTJS_BASES,
		...RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))
	]) {
		const { series } = normalizeChartjs(config);
		const chart = createChartjs(copyPlain(config));
		try {
			(series.known ? series.items : []).forEach(({ base }, index) => {
				const meta = chart.getDatasetMeta(index);
				if (!base.known) return;
				// Drawn from the pixel of the base value, aligned to half a pixel.
				for (const { base: pixel } of meta.data)
					assert.ok(
						Math.abs(pixel - meta.vScale.getPixelForValue(base.value)) <= 1,
						`${JSON.stringify(config)}: ${String(base.value)}`
					);
			});
		} finally {
			chart.destroy();
		}
	}
});

const ECHARTS_BASES = [
	{
		xAxis: { type: 'category', data: LABELS },
		yAxis: [{ startValue: 20 }],
		series: [
			{ type: 'bar', data: [60, 70] },
			{ type: 'bar', data: [50, 55] }
		]
	},
	{ yAxis: { type: 'category', data: LABELS }, xAxis: { startValue: -10 }, series: [{ type: 'bar', data: [60, 70] }] }
];

test('echarts: a known base is the value its bars are drawn from', () => {
	for (const option of [
		...ECHARTS_BASES,
		...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))
	]) {
		const { series } = normalizeEcharts(option);
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			const models = chart.getModel().getSeries();
			(series.known ? series.items : []).forEach(({ base }, index) => {
				if (!base.known) return;
				const { coordinateSystem: system } = models[index];
				const axis = system.getOtherAxis(system.getBaseAxis());
				const data = models[index].getData();
				const start = axis.toGlobalCoord(axis.dataToCoord(base.value));
				for (const layout of data.mapArray((point) => data.getItemLayout(point)))
					assert.ok(Math.abs(layout[axis.dim] - start) < 0.5, `${JSON.stringify(option)}: ${String(base.value)}`);
			});
		} finally {
			chart.dispose();
		}
	}
});

const ECHARTS_UNITS = ['{value} %', '{value}kg', 'EUR {value}', '{value}{value}'].map((formatter) => ({
	xAxis: { type: 'category', data: LABELS },
	yAxis: { axisLabel: { formatter } },
	series: [{ type: 'bar', data: [1200, 3400] }]
}));
const PLAIN = /^-?[\d.,\s]+$/u;

/** Every drawn label shows a known unit; with an empty one, every label matches `plain`. */
function labelsShow(unit, labels, where, plain = PLAIN) {
	if (!unit.known) return;
	for (const label of labels)
		assert.ok(unit.value === '' ? plain.test(label) : label.includes(unit.value), `${where}: ${label}`);
}

/** The tick labels echarts lays out for the axis `key` (`yAxis[0]`). */
function echartsLabels(chart, key) {
	const [direction, index] = key.split(/[[\]]/u);
	return chart
		.getModel()
		.getComponent(direction, Number(index))
		.axis.getViewLabels()
		.map(({ formattedLabel }) => formattedLabel);
}

test('echarts: a known unit is in every drawn tick label; without one the labels are plain numbers', () => {
	for (const option of [
		...ECHARTS_UNITS,
		...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))
	]) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			for (const { key, unit } of normalizeEcharts(option).axes)
				labelsShow(unit, unit.known ? echartsLabels(chart, key) : [], JSON.stringify(option));
		} finally {
			chart.dispose();
		}
	}
});

test('Chart.js: without a tick callback a linear scale draws plain numbers', () => {
	for (const config of RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))) {
		const chart = createChartjs(copyPlain(config));
		try {
			for (const { key, unit } of normalizeChartjs(config).axes)
				labelsShow(unit, unit.known ? chart.scales[key].ticks.map(({ label }) => String(label)) : [], key);
		} finally {
			chart.destroy();
		}
	}
});

const HIGHCHARTS = [
	{ chart: { type: 'column' }, series: [{ data: [60, 70], threshold: 20 }, { data: [5, 6] }] },
	{ chart: { type: 'bar' }, plotOptions: { bar: { threshold: -10 } }, series: [{ data: [60, 70] }] },
	{
		chart: { type: 'column' },
		plotOptions: { series: { threshold: 50, stacking: 'percent' } },
		series: [{ data: [60, 70] }, { data: [6, 7] }]
	},
	...['{value}%', '{value:.1f} kg', '{text} EUR', 'USD {value}'].map((format) => ({
		chart: { type: 'column' },
		yAxis: { labels: { format } },
		series: [{ data: [1200, 3400] }]
	}))
];

test(
	'Highcharts: a known base is where the columns grow from, a known unit is in every drawn tick label',
	{ skip: browserSkipReason() ?? false },
	async () => {
		const configs = [
			...HIGHCHARTS,
			...RULES_CONTRACT.flatMap((entry) => (entry.highcharts === undefined ? [] : [entry.highcharts.config]))
		];
		const outcomes = await runHighcharts(configs.map((config) => ({ config })));
		configs.forEach((config, index) => {
			const { series, yAxes } = outcomes[index].observed;
			const chart = normalizeHighcharts(config);
			(chart.series.known ? chart.series.items : []).forEach(({ base }, position) => {
				if (!base.known) return;
				// The threshold as the series options merge; within the axis range, the columns start there.
				assert.equal(base.value, series[position].threshold, JSON.stringify(config));
				const { min, max } = yAxes[series[position].yAxis];
				if (min <= 0 && max >= 0) assert.equal(series[position].fromZero, base.value === 0, JSON.stringify(config));
			});
			// Plain Highcharts labels abbreviate thousands (`1k`).
			for (const { key, unit } of chart.axes.filter((axis) => axis.key.startsWith('yAxis')))
				labelsShow(
					unit,
					yAxes[Number(key.slice('yAxis['.length, -1))].labels,
					JSON.stringify(config),
					/^-?[\d.,\s]+k?$/u
				);
		});
	}
);
