import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { Chart } from 'chart.js';

import { createChartjs } from '../../../../tools/conformance/lib/chartjs.mjs';
import { checkPointers } from '../../../quality/core/tests/pointers.mjs';
import { validate, withExtensions } from '../dist/index.js';

const findingsOf = (config, options) =>
	validate(config, options).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
const ambiguous = (id) => `info CFG_AMBIGUOUS $.options.scales.${id}`;

/** A scale config that tells the variants apart: `labels` is a category option, `beginAtZero` a linear one. */
const PROBE = { beginAtZero: true, labels: ['a'] };
const chart = (type, scales, { options = {}, datasets = [{ data: [1] }] } = {}) => ({
	type,
	data: { labels: ['a'], datasets },
	options: { ...options, scales }
});

test('a scale without type is checked as the type the runtime gives it (mergeScaleConfig)', () => {
	assert.deepEqual(
		findingsOf({
			type: 'bar',
			data: { datasets: [{ data: [1] }] },
			options: { scales: { y: { beginAtZerro: true, min: '50', ticks: { stepSizee: 5 } } } }
		}),
		[
			'warning CFG_UNKNOWN_KEY $.options.scales.y.beginAtZerro',
			'error CFG_TYPE $.options.scales.y.min',
			'warning CFG_UNKNOWN_KEY $.options.scales.y.ticks.stepSizee'
		]
	);
	// Bar and line: the index axis is category, the value axis linear; `indexAxis: 'y'` swaps them.
	const linear = (id) => `warning CFG_UNKNOWN_KEY $.options.scales.${id}.labels`;
	const category = (id) => `warning CFG_UNKNOWN_KEY $.options.scales.${id}.beginAtZero`;
	assert.deepEqual(findingsOf(chart('bar', { x: PROBE, y: PROBE })), [category('x'), linear('y')]);
	assert.deepEqual(findingsOf(chart('line', { x: PROBE, y: PROBE }, { options: { indexAxis: 'y' } })), [
		linear('x'),
		category('y')
	]);
	assert.deepEqual(findingsOf(chart('bar', { x: PROBE }, { options: { datasets: { bar: { indexAxis: 'y' } } } })), [
		linear('x')
	]);
	// Scatter and bubble: x and y are linear; doughnut and pie: x is category, y linear by the axis alone.
	assert.deepEqual(findingsOf(chart('scatter', { x: PROBE, y: PROBE })), [linear('x'), linear('y')]);
	assert.deepEqual(findingsOf(chart('bubble', { x: PROBE })), [linear('x')]);
	assert.deepEqual(findingsOf(chart('doughnut', { x: PROBE, y: PROBE })), [category('x'), linear('y')]);
	// An id that is not an axis: its position, else its first letter.
	assert.deepEqual(findingsOf(chart('line', { y1: PROBE, top: { ...PROBE, position: 'top' }, xAxis: PROBE })), [
		linear('y1'),
		category('top'),
		category('xAxis')
	]);
	// A dataset of another type bound to the scale gives it that type's default (mixed charts).
	assert.deepEqual(findingsOf(chart('pie', { x: PROBE }, { datasets: [{ type: 'scatter', data: [1] }] })), [
		linear('x')
	]);
	assert.deepEqual(
		findingsOf(chart('doughnut', { y2: PROBE }, { datasets: [{ type: 'line', data: [1], yAxisID: 'y2' }] })),
		[linear('y2')]
	);
});

test('every chart type takes every scale type, as the runtime looks each up in one registry', () => {
	// A radar chart builds an untyped `x` scale as category, a pie chart an untyped `r` scale as radialLinear.
	assert.deepEqual(findingsOf(chart('radar', { x: PROBE, r: { foo: 1 } })), [
		'warning CFG_UNKNOWN_KEY $.options.scales.x.beginAtZero',
		'warning CFG_UNKNOWN_KEY $.options.scales.r.foo'
	]);
	assert.deepEqual(findingsOf(chart('pie', { r: { angleLines: { display: false } } })), []);
	assert.deepEqual(findingsOf(chart('line', { r: { angleLines: { display: false } } })), [
		'warning CFG_UNKNOWN_KEY $.options.scales.r.angleLines'
	]);
	assert.deepEqual(findingsOf(chart('polarArea', { x: { type: 'category', offset: true } })), []);
	assert.deepEqual(findingsOf(chart('bar', { x: { type: 'radialLinear', angleLines: { display: false } } })), []);
});

test('a scale type nothing can decide without running code stays ambiguous', () => {
	const getter = (object, key, value) => Object.defineProperty(object, key, { get: () => value, enumerable: true });
	const cases = {
		'a plugin chart type': chart('funnel', { y: PROBE }),
		'an unreadable chart type': getter(chart('bar', {}), 'type', 'bar'),
		'an unreadable index axis': (() => {
			const config = chart('bar', { y: PROBE });
			getter(config.options, 'indexAxis', 'y');
			return config;
		})(),
		'a primitive on the way to the index axis': chart('bar', { y: PROBE }, { options: { datasets: 5 } }),
		'an unreadable type on the scale': chart('bar', { y: getter({ beginAtZero: true, labels: ['a'] }, 'type', 'x') }),
		'an object the runtime does not take for a scale (`isObject`)': chart('bar', {
			y: { ...PROBE, [Symbol.toStringTag]: 'Scale' }
		}),
		'an `axis` option on an id that is not an axis': chart('bar', { xValues: { ...PROBE, axis: 'y' } }),
		'an unreadable position': chart('bar', { values: getter({ ...PROBE }, 'position', 'left') }),
		'an id only the datasets bind': chart('bar', { values: PROBE }, { datasets: [{ data: [1], yAxisID: 'values' }] }),
		'a dataset of a plugin type': chart('pie', { x: PROBE }, { datasets: [{ type: 'funnel', data: [1] }] }),
		'an unreadable dataset type': chart('pie', { x: PROBE }, { datasets: [getter({ data: [1] }, 'type', 'bar')] }),
		'an unreadable dataset axis id': chart(
			'pie',
			{ x: PROBE },
			{ datasets: [getter({ type: 'bar', data: [1] }, 'xAxisID', 'x')] }
		),
		'datasets with a hole': chart('pie', { x: PROBE }, { datasets: [, { data: [1] }] }), // eslint-disable-line no-sparse-arrays
		'datasets that are not a list': {
			type: 'pie',
			data: { datasets: { data: [1] } },
			options: { scales: { x: PROBE } }
		}
	};
	for (const [name, config] of Object.entries(cases)) {
		const [id] = Object.keys(config.options.scales);
		assert.deepEqual(
			findingsOf(config).filter((finding) => finding.includes(`$.options.scales.${id}.`)),
			[],
			name
		);
	}
});

test('an own `type`, even undefined, is the discriminator: the runtime merge keeps it', () => {
	assert.deepEqual(findingsOf(chart('bar', { y: { ...PROBE, type: undefined } })), [ambiguous('y')]);
	assert.deepEqual(findingsOf(chart('bar', { y: { ...PROBE, type: 'category' } })), [
		'warning CFG_UNKNOWN_KEY $.options.scales.y.beginAtZero'
	]);
});

test('a partial update leaves the scale types to the chart it is merged into (A47)', () => {
	assert.ok(findingsOf(chart('bar', { y: PROBE }), { incomplete: true }).includes(ambiguous('y')));
});

test('an extended validator chooses the same types; a plugin controller decides nothing', () => {
	const validator = withExtensions([{ id: 'funnel', controllers: { funnel: { extends: 'bar' } } }]);
	const of = (config) => validator(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
	assert.deepEqual(of(chart('bar', { y: PROBE })), ['warning CFG_UNKNOWN_KEY $.options.scales.y.labels']);
	assert.ok(of(chart('funnel', { y: PROBE })).includes(ambiguous('y')));
});

const typesOf = (built) => Object.fromEntries(Object.entries(built.scales).map(([id, scale]) => [id, scale.type]));

/**
 * The type chart.js@4.6.1 builds for each configured scale. A chart that fails after building its
 * scales (a radial scale in a cartesian chart cannot be drawn) is read from `Chart.instances`.
 */
function runtimeTypes(config) {
	const before = new Set(Object.keys(Chart.instances));
	try {
		const built = createChartjs(structuredClone(config));
		const types = typesOf(built);
		built.destroy();
		return types;
	} catch {
		const failed = Object.entries(Chart.instances).find(([key]) => !before.has(key))?.[1];
		if (failed === undefined) return undefined;
		const types = typesOf(failed);
		try {
			failed.destroy();
		} catch {
			delete Chart.instances[failed.id];
		}
		return types;
	}
}

const withType = (config, id, type) => ({
	...config,
	options: { ...config.options, scales: { ...config.options.scales, [id]: { type, ...config.options.scales[id] } } }
});

/** A radial-only option, so that a linear and a radialLinear scale are told apart too. */
const RADIAL = { angleLines: { display: true } };

/** Charts whose scales the runtime types without a `type` of their own, across chart types, ids, axes and datasets. */
function contractCases() {
	const types = ['bar', 'bubble', 'doughnut', 'line', 'pie', 'polarArea', 'radar', 'scatter'];
	const scaleSets = [
		{ x: {}, y: {} },
		{ y1: {}, x2: {} },
		{ left: { position: 'left' }, top: { position: 'bottom' } },
		{ r: {} }
	];
	const optionSets = [{}, { indexAxis: 'y' }, { indexAxis: 'r' }];
	const datasetSets = [
		[{ data: [1] }],
		[{ type: 'line', data: [1], yAxisID: 'y2' }],
		[{ type: 'scatter', data: [1], xAxisID: 'x2' }],
		[{ type: 'bar', data: [1], indexAxis: 'y' }]
	];
	const probed = (scales) =>
		Object.fromEntries(Object.entries(scales).map(([id, scale]) => [id, { ...PROBE, ...RADIAL, ...scale }]));
	const product = (lists) =>
		lists.reduce((rows, list) => rows.flatMap((row) => list.map((item) => [...row, item])), [[]]);
	return product([types, scaleSets, optionSets, datasetSets]).map(([type, scales, options, datasets]) =>
		chart(type, probed(scales), { options, datasets: structuredClone(datasets) })
	);
}

test('runtime contract: every scale type chosen is the one chart.js@4.6.1 builds, checked as if named', () => {
	let decided = 0;
	for (const config of contractCases()) {
		const built = runtimeTypes(config);
		const findings = findingsOf(config);
		for (const id of Object.keys(config.options.scales)) {
			if (findings.includes(ambiguous(id))) continue;
			decided++;
			const label = `${config.type} ${JSON.stringify(config.options)} ${JSON.stringify(config.data.datasets)}: ${id}`;
			assert.ok(built?.[id] !== undefined, `${label}: decided, but the runtime builds no such scale`);
			assert.deepEqual(findings, findingsOf(withType(config, id, built[id])), label);
		}
	}
	assert.ok(decided > 300, `only ${String(decided)} scale types decided`);
});

test("built-in scales' own defaults set no type: an untyped scale named like one keeps the axis default", () => {
	for (const [name, defaults] of Object.entries(Chart.defaults.scales)) assert.equal(defaults.type, undefined, name);
});

test('every runtime pointer of the scale model names the pinned line', () => {
	assert.ok(checkPointers(fileURLToPath(new URL('../src/scales.ts', import.meta.url))) >= 20);
});

test('the schema built for one set of choices is reused, and the built schemas stay bounded', () => {
	const config = (index) => chart('line', { [`x${String(index)}`]: PROBE });
	const category = (index) => [`warning CFG_UNKNOWN_KEY $.options.scales.x${String(index)}.beginAtZero`];
	for (let index = 0; index < 70; index++) assert.deepEqual(findingsOf(config(index)), category(index));
	for (let index = 0; index < 70; index++) assert.deepEqual(findingsOf(config(index)), category(index));
});
