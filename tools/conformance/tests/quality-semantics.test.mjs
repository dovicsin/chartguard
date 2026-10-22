import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { SEMANTICS_CONTRACT, summarize } from '../../../packages/quality/core/tests/fixtures/semantics-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { normalize as normalizeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/**
 * The quality semantics against the runtimes (CG-05-03): every extractor gives each contract chart the
 * same semantics, and each known fact is what the pinned runtime builds from that config.
 */
const known = (fact) => (fact.known ? fact.value : undefined);

for (const entry of SEMANTICS_CONTRACT)
	for (const [library, normalize] of [['chartjs', normalizeChartjs], ['echarts', normalizeEcharts], ['highcharts', normalizeHighcharts]])
		test(`quality semantics, ${library}: ${entry.name}`, () => assert.deepEqual(summarize(normalize(entry[library])), entry.semantics));

/** Chart.js configs whose scale binding has a runtime rule of its own, beyond the contract. */
const CHARTJS_BINDINGS = [
	{ type: 'bar', data: { datasets: [{ data: [1] }] }, options: { scales: { y1: { position: 'right' } } } },
	{ type: 'bar', data: { datasets: [{ data: [1] }] }, options: { scales: { amount: { axis: 'y' }, top: { position: 'top' } } } },
	{ type: 'bar', data: { datasets: [{ data: [1] }, { data: [2], yAxisID: 'money' }] }, options: { scales: { money: {} } } },
	{ type: 'bar', data: { datasets: [{ data: [1], yAxisID: 'first' }, { data: [2] }] } },
	{ type: 'bar', data: { datasets: [{ data: [1], indexAxis: 'y' }, { data: [2] }] }, options: { scales: { x: { stacked: true } } } },
	{ type: 'line', data: { datasets: [{ data: [1], stack: 'a' }, { data: [2], fill: 'origin' }] }, options: { elements: { line: { fill: false } } } },
	{ type: 'radar', data: { labels: ['a'], datasets: [{ data: [1] }] } }
];

test('Chart.js: every known binding, orientation, stacking and area is what the runtime builds', () => {
	for (const config of [...SEMANTICS_CONTRACT.map((entry) => entry.chartjs), ...CHARTJS_BINDINGS]) {
		const { series } = normalizeChartjs(config);
		const chart = createChartjs(copyPlain(config));
		try {
			series.items.forEach(({ kind, valueAxis, orientation, stacking }, index) => {
				const meta = chart.getDatasetMeta(index);
				const where = `${JSON.stringify(config)} dataset ${String(index)}`;
				if (valueAxis.known) assert.equal(valueAxis.value, meta.vScale.id, where);
				if (orientation.known) assert.equal(orientation.value, meta.iScale.axis === 'x' ? 'vertical' : 'horizontal', where);
				if (stacking.known) assert.equal(stacking.value, meta._stacked ? 'stacked' : 'none', where);
				if (known(kind) === 'area' || known(kind) === 'line') assert.equal(known(kind) === 'area', meta.dataset.options.fill !== false, where);
			});
		} finally {
			chart.destroy();
		}
	}
});

const ECHARTS_CASES = [
	{ xAxis: [{ type: 'category', data: ['a'] }], yAxis: [{}, { id: 'right' }], series: [{ type: 'line', yAxisId: 'right', data: [1] }, { type: 'bar', stack: '', data: [1] }] },
	{ xAxis: { data: ['a'] }, yAxis: {}, series: [{ type: 'line', areaStyle: null, data: [1] }] },
	{ xAxis: {}, yAxis: { data: ['a'] }, series: [{ type: 'bar', data: [1] }] }
];

/** The grid layout echarts built for a series: which axis is its base, and which carries its values. */
function gridOf(system) {
	if (system?.type !== 'cartesian2d') return { coordinateSystem: system?.type };
	const base = system.getBaseAxis();
	const other = system.getOtherAxis(base);
	return {
		coordinateSystem: 'cartesian',
		orientation: base.dim === 'x' ? 'vertical' : 'horizontal',
		valueAxis: `${other.dim}Axis[${String(other.model.componentIndex)}]`
	};
}

/** What echarts built for a series, in the semantics' terms. */
const builtEcharts = (model) => ({
	...gridOf(model.coordinateSystem),
	stacking: model.get('stack') ? 'stacked' : 'none',
	area: !model.getModel('areaStyle').isEmpty()
});

/** Each known fact equals what the runtime built; a line or area kind matches whether it fills. */
function agree({ kind, coordinateSystem, orientation, valueAxis, stacking }, built, where) {
	for (const [name, fact] of Object.entries({ coordinateSystem, orientation, valueAxis, stacking }))
		if (fact.known) assert.equal(fact.value, built[name], `${where} ${name}`);
	if (known(kind) === 'area' || known(kind) === 'line') assert.equal(known(kind) === 'area', built.area, `${where} kind`);
}

test('ECharts: every known binding, orientation, stacking and area is what the runtime builds', () => {
	for (const option of [...SEMANTICS_CONTRACT.map((entry) => entry.echarts), ...ECHARTS_CASES]) {
		const { series } = normalizeEcharts(option);
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			const models = chart.getModel().getSeries();
			series.items.forEach((semantics, index) => agree(semantics, builtEcharts(models[index]), `${JSON.stringify(option)} series ${String(index)}`));
		} finally {
			chart.dispose();
		}
	}
});

const HIGHCHARTS_CASES = [
	{ chart: { inverted: false }, series: [{ type: 'line', data: [1] }, { type: 'bar', data: [2] }] },
	{ chart: { polar: true }, series: [{ type: 'column', data: [1, 2] }] },
	{ yAxis: [{}, { id: 'r' }], plotOptions: { column: { stacking: 'percent' } }, series: [{ type: 'column', yAxis: 'r', data: [1] }, { type: 'line', data: [2] }] }
];
const browser = { skip: browserSkipReason() ?? false };

test('Highcharts: every known binding, orientation and stacking is what the chart builds', browser, async () => {
	const configs = [...SEMANTICS_CONTRACT.map((entry) => entry.highcharts), ...HIGHCHARTS_CASES];
	const outcomes = await runHighcharts(configs.map((config) => ({ config })));
	configs.forEach((config, position) => {
		const { observed, threw } = outcomes[position];
		assert.equal(threw, undefined);
		normalizeHighcharts(config).series.items.forEach(({ valueAxis, orientation, stacking, coordinateSystem }, index) => {
			const built = observed.series[index];
			const where = `${JSON.stringify(config)} series ${String(index)}`;
			if (coordinateSystem.known) assert.equal(coordinateSystem.value === 'polar', observed.polar, where);
			if (orientation.known) assert.equal(orientation.value === 'horizontal', observed.inverted, where);
			if (valueAxis.known) assert.equal(valueAxis.value, `yAxis[${String(built.yAxis)}]`, where);
			if (stacking.known) assert.equal(stacking.value, { normal: 'stacked', percent: 'percent' }[built.stacking] ?? 'none', where);
		});
	});
});
