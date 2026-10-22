import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { analyze as analyzeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { analyze as analyzeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { analyze as analyzeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { createChartjs, runChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/**
 * The rule catalog against the runtimes (CG-05-04): every contract chart renders on its pinned runtime,
 * each adapter reports exactly the contract's findings, and each finding's premise holds in what the
 * runtime built; where a rule is silent, its premise does not hold. A premise reads the runtime's own
 * model: the value axes the series are measured on, their range, scale and direction.
 */
const PREMISES = {
	VIS_BAR_BASELINE: ({ bars }) => bars.some(({ min, max, log }) => !log && (min > 0 || max < 0)),
	VIS_BAR_LOG_SCALE: ({ bars }) => bars.some(({ log }) => log),
	VIS_REVERSED_VALUE_AXIS: ({ valueAxes }) => valueAxes.some(({ reversed }) => reversed),
	VIS_DUAL_AXIS: ({ valueAxes }) => new Set(valueAxes.map(({ id }) => id)).size >= 2
};

function checkPremises(findings, built, where) {
	const codes = new Set(findings.map((finding) => finding.split(' ')[0]));
	for (const [code, premise] of Object.entries(PREMISES)) assert.equal(premise(built), codes.has(code), `${where}: ${code}`);
}

/** The value scales Chart.js built for the datasets (bars and other cartesian ones). */
function builtChartjs(config) {
	const chart = createChartjs(copyPlain(config));
	try {
		const metas = chart.data.datasets.map((_, index) => chart.getDatasetMeta(index)).filter(({ vScale }) => vScale !== undefined);
		const axis = ({ vScale }) => ({ id: vScale.id, min: vScale.min, max: vScale.max, log: vScale.type === 'logarithmic', reversed: vScale.options.reverse === true });
		return { bars: metas.filter(({ type }) => type === 'bar').map(axis), valueAxes: metas.map(axis) };
	} finally {
		chart.destroy();
	}
}

/** The value axes echarts built for its grid series. */
function builtEcharts(option) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	try {
		chart.setOption(copyPlain(option));
		const measured = chart
			.getModel()
			.getSeries()
			.filter((model) => model.coordinateSystem?.type === 'cartesian2d')
			.map((model) => {
				const system = model.coordinateSystem;
				const axis = system.getOtherAxis(system.getBaseAxis());
				const [min, max] = axis.scale.getExtent();
				return { type: model.subType, id: `${axis.dim}${String(axis.model.componentIndex)}`, min, max, log: axis.type === 'log', reversed: axis.inverse === true };
			});
		return { bars: measured.filter(({ type }) => type === 'bar'), valueAxes: measured };
	} finally {
		chart.dispose();
	}
}

/** The y axes Highcharts built for its series (recorded by the page runner). */
function builtHighcharts({ series, yAxes }) {
	const measured = series
		.filter(({ yAxis }) => yAxis !== null)
		.map(({ type, yAxis }) => ({ type, id: yAxis, ...yAxes[yAxis] }));
	return { bars: measured.filter(({ type }) => type === 'column' || type === 'bar'), valueAxes: measured };
}

const run = (config, render) => verdictOf(render(copyPlain(config)));

for (const entry of RULES_CONTRACT) {
	if (entry.chartjs !== undefined)
		test(`quality rules, chartjs: ${entry.name}`, () => {
			const { config, findings } = entry.chartjs;
			assert.equal(run(config, runChartjs), 'accepted');
			assert.deepEqual(
				analyzeChartjs(config).diagnostics.map((d) => `${d.code} ${d.path}`),
				findings
			);
			checkPremises(findings, builtChartjs(config), entry.name);
		});
	if (entry.echarts !== undefined)
		test(`quality rules, echarts: ${entry.name}`, () => {
			const { config, findings } = entry.echarts;
			assert.equal(run(config, runEcharts), 'accepted');
			assert.deepEqual(
				analyzeEcharts(config).diagnostics.map((d) => `${d.code} ${d.path}`),
				findings
			);
			checkPremises(findings, builtEcharts(config), entry.name);
		});
}

const browser = { skip: browserSkipReason() ?? false };
const highcharts = RULES_CONTRACT.filter((entry) => entry.highcharts !== undefined);

test('quality rules, highcharts: every contract chart renders, gets its findings, and their premises hold', browser, async () => {
	const outcomes = await runHighcharts(highcharts.map((entry) => ({ config: entry.highcharts.config })));
	highcharts.forEach((entry, index) => {
		const { config, findings } = entry.highcharts;
		assert.equal(verdictOf(outcomes[index]), 'accepted', `${entry.name}: ${JSON.stringify(outcomes[index].messages)}`);
		assert.deepEqual(
			analyzeHighcharts(config).diagnostics.map((d) => `${d.code} ${d.path}`),
			findings,
			entry.name
		);
		checkPremises(findings, builtHighcharts(outcomes[index].observed), entry.name);
	});
});
