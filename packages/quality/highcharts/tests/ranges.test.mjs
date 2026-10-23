import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const brief = (fact) =>
	fact.known ? `${String(fact.value)} ${fact.source} ${fact.path}` : `? ${fact.reason} ${fact.path}`;
const findings = (config, code) =>
	analyze(config)
		.diagnostics.filter((d) => d.code === code)
		.map(({ path }) => path);
const yAxis = (config) => normalize(config).axes.find(({ key }) => key === 'yAxis[0]');

test('base: a bar grows from its threshold, through the series, plotOptions for its type and plotOptions.series', () => {
	const bases = (config) => normalize(config).series.items.map(({ base }) => brief(base));
	assert.deepEqual(bases({ chart: { type: 'column' }, series: [{ data: [60] }] }), ['0 default $.series[0].threshold']);
	const own = { chart: { type: 'column' }, series: [{ data: [60], threshold: 50 }] };
	assert.deepEqual(bases(own), ['50 config $.series[0].threshold']);
	assert.deepEqual(findings(own, 'VIS_BAR_BASELINE'), ['$.series[0].threshold']);
	const scoped = {
		chart: { type: 'column' },
		plotOptions: { column: { threshold: 50 }, series: { threshold: 10 } },
		series: [{ data: [60] }, { data: [70] }]
	};
	assert.deepEqual(findings(scoped, 'VIS_BAR_BASELINE'), ['$.plotOptions.column.threshold']);
	assert.deepEqual(bases({ series: [{ type: 'line', data: [60], threshold: 5 }] }), [
		'? inapplicable $.series[0].threshold'
	]);
	assert.deepEqual(bases({ chart: { type: 'bar' }, series: [{ data: [60], threshold: () => 1 }] }), [
		'? dynamic $.series[0].threshold'
	]);
	// A logarithmic axis has no zero: a threshold below its range is moved to its minimum.
	assert.deepEqual(bases({ chart: { type: 'column' }, yAxis: [{ type: 'logarithmic' }], series: [{ data: [60] }] }), [
		'? inapplicable $.series[0].threshold'
	]);
	assert.deepEqual(bases({ chart: { type: 'column' }, yAxis: { type: () => 'x' }, series: [{ data: [60] }] }), [
		'? inapplicable $.series[0].threshold'
	]);
	assert.deepEqual(
		bases({ chart: { type: 'column' }, yAxis: [{}, { type: 'logarithmic' }], series: [{ data: [60] }] }),
		['0 default $.series[0].threshold']
	);
	assert.deepEqual(
		findings({ chart: { type: 'column' }, series: [{ data: [60], threshold: 0 }] }, 'VIS_BAR_BASELINE'),
		[]
	);
});

test('fit: no threshold or a hard one makes the tick algorithm fit the axis to the data and the plot size', () => {
	const fit = (config) => brief(yAxis(config).fit);
	assert.equal(fit({ chart: { type: 'column' }, series: [{ data: [60] }] }), '? unset $.yAxis');
	const none = { chart: { type: 'column' }, plotOptions: { series: { threshold: null } }, series: [{ data: [60] }] };
	assert.equal(fit(none), '? layout $.plotOptions.series.threshold');
	assert.equal(brief(normalize(none).series.items[0].base), '? layout $.plotOptions.series.threshold');
	assert.equal(
		fit({ chart: { type: 'column' }, series: [{ data: [60], softThreshold: false }] }),
		'? layout $.series[0].softThreshold'
	);
	// A line's soft threshold does not fit a bar axis.
	assert.equal(fit({ series: [{ type: 'line', data: [60], softThreshold: false }] }), '? unset $.yAxis');
	assert.deepEqual(findings(none, 'VIS_BAR_BASELINE'), []);
});

test('unit: a formatter decides at runtime; a format is the unit around {value} and {text}', () => {
	const unit = (labels) => brief(yAxis({ yAxis: { labels } }).unit);
	assert.equal(unit(undefined), ' default $.yAxis.labels.format');
	assert.equal(unit({ format: '{value}%' }), '% config $.yAxis.labels.format');
	assert.equal(unit({ format: '{value:.0f} %' }), '% config $.yAxis.labels.format');
	assert.equal(unit({ format: '{text} kg' }), 'kg config $.yAxis.labels.format');
	assert.equal(unit({ format: '{point.y}' }), '? unmodelled $.yAxis.labels.format');
	assert.equal(unit({ format: 'none' }), '? unmodelled $.yAxis.labels.format');
	assert.equal(unit({ format: '{value}%', formatter: () => 'x' }), '? dynamic $.yAxis.labels.formatter');
});

test('percent without unit: percent-stacked bars and areas on an axis whose labels and title show no %', () => {
	const percent = (yAxisOptions, type = 'column') => ({
		chart: { type },
		yAxis: yAxisOptions,
		plotOptions: { series: { stacking: 'percent' } },
		series: [{ data: [60] }, { data: [40] }]
	});
	assert.deepEqual(findings(percent({ title: { text: 'Share' } }), 'VIS_PERCENT_WITHOUT_UNIT'), [
		'$.yAxis.labels.format'
	]);
	assert.deepEqual(findings(percent({ title: { text: 'Share' } }, 'area'), 'VIS_PERCENT_WITHOUT_UNIT'), [
		'$.yAxis.labels.format'
	]);
	assert.deepEqual(
		findings(percent({ title: { text: 'Share' }, labels: { format: '{text} pct' } }), 'VIS_PERCENT_WITHOUT_UNIT'),
		['$.yAxis.labels.format']
	);
	// The default title "Values" says nothing about shares either.
	assert.deepEqual(findings(percent({}), 'VIS_PERCENT_WITHOUT_UNIT'), ['$.yAxis.labels.format']);
	for (const options of [
		{ labels: { format: '{value}%' } },
		{ title: { text: 'Share (%)' } },
		{ title: { text: 'Share' }, labels: { formatter: () => 'x' } },
		{ title: { text: 'Share' }, labels: { format: '{point.y}' } }
	])
		assert.deepEqual(findings(percent(options), 'VIS_PERCENT_WITHOUT_UNIT'), [], JSON.stringify(options));
	const normal = { ...percent({ title: { text: 'Units' } }), plotOptions: { series: { stacking: 'normal' } } };
	assert.deepEqual(findings(normal, 'VIS_PERCENT_WITHOUT_UNIT'), []);
});

test('a y axis bound rounds to a tick (startOnTick, endOnTick): it is the configured value only when they are off, or when it is zero (H7)', () => {
	const yAxisOf = (config) =>
		normalize({ chart: { type: 'column' }, series: [{ data: [60, 100] }], ...config }).axes.find(
			({ key }) => key === 'yAxis[0]'
		);
	assert.equal(brief(yAxisOf({}).min), '? unset $.yAxis.min');
	assert.equal(brief(yAxisOf({ yAxis: { min: 5 } }).min), '? layout $.yAxis.min');
	assert.equal(brief(yAxisOf({ yAxis: { min: 5, startOnTick: false } }).min), '5 config $.yAxis.min');
	assert.equal(brief(yAxisOf({ yAxis: { min: 0 } }).min), '0 config $.yAxis.min');
	assert.equal(brief(yAxisOf({ yAxis: { min: -5 } }).min), '? layout $.yAxis.min');
	assert.equal(brief(yAxisOf({ yAxis: { max: -50 } }).max), '? layout $.yAxis.max');
	assert.equal(brief(yAxisOf({ yAxis: { max: -50, endOnTick: false } }).max), '-50 config $.yAxis.max');
	// Highcharts draws columns from 0 when a minimum of 5 rounds to the tick 0: no claim, no fix.
	assert.deepEqual(
		findings({ chart: { type: 'column' }, yAxis: { min: 5 }, series: [{ data: [60, 100] }] }, 'VIS_BAR_BASELINE'),
		[]
	);
	assert.deepEqual(
		findings(
			{ chart: { type: 'column' }, yAxis: { min: 5, startOnTick: false }, series: [{ data: [60, 100] }] },
			'VIS_BAR_BASELINE'
		),
		['$.yAxis.min']
	);
	// An x axis does not start on a tick by default.
	assert.equal(
		brief(normalize({ xAxis: { min: 5 } }).axes.find(({ key }) => key === 'xAxis[0]').min),
		'5 config $.xAxis.min'
	);
});
