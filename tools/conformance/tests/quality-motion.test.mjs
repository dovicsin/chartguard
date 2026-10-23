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
import { chartjsMotion, echartsMotion } from '../lib/motion.mjs';

/**
 * The motion facts against the runtimes (CG-05-04 part 7): every known `endless` and `longest` is what
 * the pinned runtime resolves (Chart.js animation options, echarts looping animators and durations,
 * Highcharts series animations).
 */
const LINE = { type: 'line', data: { labels: ['a'], datasets: [{ data: [1] }] } };
const CHARTJS = [
	LINE,
	{ ...LINE, options: { animation: { loop: true } } },
	{ ...LINE, options: { animation: { duration: 6000 }, animations: { y: { duration: 7000 } } } },
	{ ...LINE, options: { animations: { x: { loop: true } } } },
	{ ...LINE, options: { animation: false } }
];
const AXES = { xAxis: { type: 'category', data: ['a'] }, yAxis: {} };
const ECHARTS = [
	{ ...AXES, series: [{ type: 'bar', data: [1] }] },
	{ ...AXES, series: [{ type: 'effectScatter', data: [1] }] },
	{ ...AXES, animation: false, series: [{ type: 'effectScatter', data: [1] }] },
	{ ...AXES, series: [{ type: 'effectScatter', showEffectOn: 'emphasis', data: [1] }] },
	{
		xAxis: { type: 'value' },
		yAxis: { type: 'value' },
		series: [
			{
				type: 'lines',
				coordinateSystem: 'cartesian2d',
				effect: { show: true },
				data: [
					{
						coords: [
							[0, 0],
							[1, 1]
						]
					}
				]
			}
		]
	},
	{ ...AXES, animationDuration: 6000, series: [{ type: 'bar', animationDuration: 7000, data: [1] }] }
];
const HIGHCHARTS = [
	{ series: [{ data: [1] }] },
	{
		plotOptions: { series: { animation: { duration: 8000 } } },
		series: [{ data: [1] }, { animation: false, data: [1] }]
	},
	{
		series: [
			{ animation: true, data: [1] },
			{ animation: { defer: 10 }, data: [1] }
		]
	},
	// An object merges over the scopes below it: over `false` it has no duration (500 ms), over a duration it keeps it.
	{ plotOptions: { series: { animation: false } }, series: [{ animation: { defer: 10 }, data: [1] }] },
	{
		plotOptions: { column: { animation: { duration: 6000 } } },
		series: [{ type: 'column', animation: { defer: 10 }, data: [1] }]
	}
];
const contract = (library) =>
	RULES_CONTRACT.flatMap((entry) => (entry[library] === undefined ? [] : [entry[library].config]));

function agree({ endless, longest }, built, where) {
	if (endless.known) assert.equal(endless.value, built.endless, `${where} endless`);
	if (longest.known) assert.equal(longest.value, built.longest, `${where} longest`);
}

test('Chart.js: endless and longest are what a dataset controller resolves', () => {
	for (const config of [...CHARTJS, ...contract('chartjs')]) {
		const chart = createChartjs(copyPlain(config));
		try {
			const built = chartjsMotion(chart, config);
			if (built !== undefined) agree(normalizeChartjs(config).motion, built, JSON.stringify(config));
		} finally {
			chart.destroy();
		}
	}
});

test('ECharts: endless is a looping animator in the rendered chart; longest is the resolved animation duration', () => {
	for (const option of [...ECHARTS, ...contract('echarts')]) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			agree(normalizeEcharts(option).motion, echartsMotion(chart), JSON.stringify(option));
		} finally {
			chart.dispose();
		}
	}
});

const browser = { skip: browserSkipReason() ?? false };

test('Highcharts: longest is the longest series animation as Highcharts resolves it', browser, async () => {
	const configs = [...HIGHCHARTS, ...contract('highcharts')];
	const outcomes = await runHighcharts(configs.map((config) => ({ config })));
	configs.forEach((config, index) => {
		const { longest } = normalizeHighcharts(config).motion;
		if (longest.known)
			assert.equal(longest.value, Math.max(0, ...outcomes[index].observed.durations), JSON.stringify(config));
	});
});
