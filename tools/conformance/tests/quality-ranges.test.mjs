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
 * Ranges fitted to the data, bar bases and units against the runtimes (CG-05-04 part 8). A known `fit`
 * holds at every size the chart is drawn at: `excluded` leaves zero out of the built range at each
 * one, `included` keeps it in at each one (Chart.js from a 20 px to a 2000 px scale, echarts at three
 * sizes). A known `base` is where the runtime draws the bars from; a known `unit` is in every drawn
 * tick label, and an empty one leaves them plain numbers.
 */

/** A seeded generator (mulberry32): the same data sets on every run. */
function random(seed) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}

/** Data sets around and away from zero, of one to five values, some negative, some repeated. */
function dataSets(count) {
	const next = random(5);
	return Array.from({ length: count }, () => {
		const base = next() < 0.5 ? next() * 100 : next() * 10_000;
		const spread = next() * base * (next() < 0.5 ? 0.2 : 3);
		const decimals = next() < 0.5 ? 1 : 100;
		const values = Array.from({ length: 1 + Math.floor(next() * 5) }, () => Math.round((base + next() * spread) * decimals) / decimals);
		return next() < 0.2 ? values.map((value) => -value) : values;
	});
}

const DATA = [[60, 70], [5, 70], [30, 100], [-60, -70], [50], [0], [0.52], [1339431], ...dataSets(300)];
const LENGTHS = [20, 40, 60, 80, 100, 150, 200, 300, 500, 800, 1200, 2000];
const excludes = ([min, max]) => min > 0 || max < 0;

/** Every size agrees with a known fit; returns whether the fit was known. */
function agree(fit, ranges, where) {
	if (!fit.known) return false;
	for (const range of ranges) assert.equal(excludes(range), fit.value === 'excluded', `${where}: ${fit.value} but drew ${range.join('..')}`);
	return true;
}

const chartjsBars = (data, y, indexAxis) => ({
	type: 'bar',
	data: { labels: data.map(String), datasets: [{ data }] },
	options: { indexAxis, scales: { [indexAxis === 'y' ? 'x' : 'y']: y } }
});

/** The value scale's range as Chart.js builds it with the scale `length` pixels long. */
function chartjsRange(config, length) {
	const horizontal = config.options?.indexAxis === 'y';
	const chart = createChartjs(copyPlain(config), horizontal ? { width: length, height: 300 } : { width: 400, height: length });
	try {
		const { vScale } = chart.getDatasetMeta(0);
		return [vScale.min, vScale.max];
	} finally {
		chart.destroy();
	}
}

test('Chart.js: a known fit holds at every scale length from 20 to 2000 pixels', () => {
	const variants = [{ beginAtZero: false }, { beginAtZero: false, ticks: { maxTicksLimit: 4 } }, { beginAtZero: false, ticks: { maxTicksLimit: 1 } }, { beginAtZero: false, bounds: 'data' }];
	const configs = [
		...DATA.flatMap((data) => variants.map((y) => chartjsBars(data, y))),
		...DATA.slice(0, 40).map((data) => chartjsBars(data, { beginAtZero: false }, 'y')),
		...RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))
	];
	let known = 0;
	for (const config of configs) {
		const key = config.options?.indexAxis === 'y' ? 'x' : 'y';
		const fit = normalizeChartjs(config).axes.find((axis) => axis.key === key)?.fit;
		if (fit !== undefined && agree(fit, LENGTHS.map((length) => chartjsRange(config, length)), JSON.stringify(config.data.datasets[0].data))) known += 1;
	}
	assert.ok(known > 600, `${String(known)} known fits`);
});

/** The range echarts builds for the first series' value axis at one size. */
function echartsRange(option, [width, height]) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
	try {
		chart.setOption(copyPlain(option));
		const system = chart.getModel().getSeries()[0].coordinateSystem;
		return system.getOtherAxis(system.getBaseAxis()).scale.getExtent();
	} finally {
		chart.dispose();
	}
}

test('echarts: a known fit holds at every size', () => {
	const variants = [{ scale: true }, { scale: true, splitNumber: 2 }, { scale: true, splitNumber: 8 }];
	const options = [
		...DATA.flatMap((data) => variants.map((yAxis) => ({ xAxis: { type: 'category', data: data.map(String) }, yAxis, series: [{ type: 'bar', data }] }))),
		...DATA.slice(0, 40).map((data) => ({ yAxis: { type: 'category', data: data.map(String) }, xAxis: { scale: true }, series: [{ type: 'bar', data }] })),
		...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))
	];
	let known = 0;
	for (const option of options) {
		const { axes, series } = normalizeEcharts(option);
		const key = series.known ? series.items[0]?.valueAxis : undefined;
		const fit = key?.known ? axes.find((axis) => axis.key === key.value)?.fit : undefined;
		if (fit !== undefined && agree(fit, [[400, 300], [120, 80], [1600, 1200]].map((size) => echartsRange(option, size)), JSON.stringify(option.series))) known += 1;
	}
	assert.ok(known > 600, `${String(known)} known fits`);
});

const LABELS = ['a', 'b'];
const CHARTJS_BASES = [
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70], base: 20 }, { data: [5, 6] }] } },
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70] }] }, options: { datasets: { bar: { base: 15 } }, base: 3 } },
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70] }] }, options: { base: -5 } },
	{ type: 'bar', data: { labels: LABELS, datasets: [{ data: [60, 70] }] }, options: { indexAxis: 'y', base: 10 } }
];

test('Chart.js: a known base is the value its bars are drawn from', () => {
	for (const config of [...CHARTJS_BASES, ...RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))]) {
		const { series } = normalizeChartjs(config);
		const chart = createChartjs(copyPlain(config));
		try {
			(series.known ? series.items : []).forEach(({ base }, index) => {
				const meta = chart.getDatasetMeta(index);
				if (!base.known) return;
				// Drawn from the pixel of the base value, aligned to half a pixel.
				for (const { base: pixel } of meta.data) assert.ok(Math.abs(pixel - meta.vScale.getPixelForValue(base.value)) <= 1, `${JSON.stringify(config)}: ${String(base.value)}`);
			});
		} finally {
			chart.destroy();
		}
	}
});

const ECHARTS_BASES = [
	{ xAxis: { type: 'category', data: LABELS }, yAxis: [{ startValue: 20 }], series: [{ type: 'bar', data: [60, 70] }, { type: 'bar', data: [50, 55] }] },
	{ yAxis: { type: 'category', data: LABELS }, xAxis: { startValue: -10 }, series: [{ type: 'bar', data: [60, 70] }] }
];

test('echarts: a known base is the value its bars are drawn from', () => {
	for (const option of [...ECHARTS_BASES, ...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))]) {
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
				for (const layout of data.mapArray((point) => data.getItemLayout(point))) assert.ok(Math.abs(layout[axis.dim] - start) < 0.5, `${JSON.stringify(option)}: ${String(base.value)}`);
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
	for (const label of labels) assert.ok(unit.value === '' ? plain.test(label) : label.includes(unit.value), `${where}: ${label}`);
}

/** The tick labels echarts lays out for the axis `key` (`yAxis[0]`). */
function echartsLabels(chart, key) {
	const [direction, index] = key.split(/[[\]]/u);
	return chart.getModel().getComponent(direction, Number(index)).axis.getViewLabels().map(({ formattedLabel }) => formattedLabel);
}

test('echarts: a known unit is in every drawn tick label; without one the labels are plain numbers', () => {
	for (const option of [...ECHARTS_UNITS, ...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))]) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			for (const { key, unit } of normalizeEcharts(option).axes) labelsShow(unit, unit.known ? echartsLabels(chart, key) : [], JSON.stringify(option));
		} finally {
			chart.dispose();
		}
	}
});

test('Chart.js: without a tick callback a linear scale draws plain numbers', () => {
	for (const config of RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))) {
		const chart = createChartjs(copyPlain(config));
		try {
			for (const { key, unit } of normalizeChartjs(config).axes) labelsShow(unit, unit.known ? chart.scales[key].ticks.map(({ label }) => String(label)) : [], key);
		} finally {
			chart.destroy();
		}
	}
});

const HIGHCHARTS = [
	{ chart: { type: 'column' }, series: [{ data: [60, 70], threshold: 20 }, { data: [5, 6] }] },
	{ chart: { type: 'bar' }, plotOptions: { bar: { threshold: -10 } }, series: [{ data: [60, 70] }] },
	{ chart: { type: 'column' }, plotOptions: { series: { threshold: 50, stacking: 'percent' } }, series: [{ data: [60, 70] }, { data: [6, 7] }] },
	...['{value}%', '{value:.1f} kg', '{text} EUR', 'USD {value}'].map((format) => ({ chart: { type: 'column' }, yAxis: { labels: { format } }, series: [{ data: [1200, 3400] }] }))
];

test('Highcharts: a known base is where the columns grow from, a known unit is in every drawn tick label', { skip: browserSkipReason() ?? false }, async () => {
	const configs = [...HIGHCHARTS, ...RULES_CONTRACT.flatMap((entry) => (entry.highcharts === undefined ? [] : [entry.highcharts.config]))];
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
			labelsShow(unit, yAxes[Number(key.slice('yAxis['.length, -1))].labels, JSON.stringify(config), /^-?[\d.,\s]+k?$/u);
	});
});
