import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';

/**
 * Ranges fitted to the data against the runtimes (CG-05-04 part 8). A known `fit`
 * holds at every size the chart is drawn at: `excluded` leaves zero out of the built range at each
 * one, `included` keeps it in at each one (Chart.js from a 20 px to a 2000 px scale, echarts at three
 * sizes). Bases and units: quality-bases.test.mjs.
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
		const values = Array.from(
			{ length: 1 + Math.floor(next() * 5) },
			() => Math.round((base + next() * spread) * decimals) / decimals
		);
		return next() < 0.2 ? values.map((value) => -value) : values;
	});
}

const DATA = [[60, 70], [5, 70], [30, 100], [-60, -70], [50], [0], [0.52], [1339431], ...dataSets(300)];
const LENGTHS = [20, 40, 60, 80, 100, 150, 200, 300, 500, 800, 1200, 2000];
const excludes = ([min, max]) => min > 0 || max < 0;

/** Every size agrees with a known fit; returns whether the fit was known. */
function agree(fit, ranges, where) {
	if (!fit.known) return false;
	for (const range of ranges)
		assert.equal(excludes(range), fit.value === 'excluded', `${where}: ${fit.value} but drew ${range.join('..')}`);
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
	const chart = createChartjs(
		copyPlain(config),
		horizontal ? { width: length, height: 300 } : { width: 400, height: length }
	);
	try {
		const { vScale } = chart.getDatasetMeta(0);
		return [vScale.min, vScale.max];
	} finally {
		chart.destroy();
	}
}

test('Chart.js: a known fit holds at every scale length from 20 to 2000 pixels', () => {
	const variants = [
		{ beginAtZero: false },
		{ beginAtZero: false, ticks: { maxTicksLimit: 4 } },
		{ beginAtZero: false, ticks: { maxTicksLimit: 1 } },
		{ beginAtZero: false, ticks: { maxTicksLimit: 50 } },
		{ beginAtZero: false, bounds: 'data' }
	];
	const configs = [
		...DATA.flatMap((data) => variants.map((y) => chartjsBars(data, y))),
		...DATA.slice(0, 40).map((data) => chartjsBars(data, { beginAtZero: false }, 'y')),
		...RULES_CONTRACT.flatMap((entry) => (entry.chartjs === undefined ? [] : [entry.chartjs.config]))
	];
	let known = 0;
	for (const config of configs) {
		const key = config.options?.indexAxis === 'y' ? 'x' : 'y';
		const fit = normalizeChartjs(config).axes.find((axis) => axis.key === key)?.fit;
		if (
			fit !== undefined &&
			agree(
				fit,
				LENGTHS.map((length) => chartjsRange(config, length)),
				JSON.stringify(config.data.datasets[0].data)
			)
		)
			known += 1;
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
		...DATA.flatMap((data) =>
			variants.map((yAxis) => ({
				xAxis: { type: 'category', data: data.map(String) },
				yAxis,
				series: [{ type: 'bar', data }]
			}))
		),
		...DATA.slice(0, 40).map((data) => ({
			yAxis: { type: 'category', data: data.map(String) },
			xAxis: { scale: true },
			series: [{ type: 'bar', data }]
		})),
		...RULES_CONTRACT.flatMap((entry) => (entry.echarts === undefined ? [] : [entry.echarts.config]))
	];
	let known = 0;
	for (const option of options) {
		const { axes, series } = normalizeEcharts(option);
		const key = series.known ? series.items[0]?.valueAxis : undefined;
		const fit = key?.known ? axes.find((axis) => axis.key === key.value)?.fit : undefined;
		if (
			fit !== undefined &&
			agree(
				fit,
				[
					[400, 300],
					[120, 80],
					[1600, 1200]
				].map((size) => echartsRange(option, size)),
				JSON.stringify(option.series)
			)
		)
			known += 1;
	}
	assert.ok(known > 600, `${String(known)} known fits`);
});
