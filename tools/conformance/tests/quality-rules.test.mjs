import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { analyze as analyzeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { colorKey, contrastRatio } from '../../../packages/quality/core/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { analyze as analyzeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { analyze as analyzeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { createChartjs, runChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { runEchartsInBrowser } from '../lib/echarts-browser.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';
import { chartjsMotion, echartsMotion } from '../lib/motion.mjs';

/**
 * The rule catalog against the runtimes (CG-05-04): every contract chart renders on its pinned runtime,
 * each adapter reports exactly the contract's findings, and each finding's premise holds in what the
 * runtime built; where a rule is silent, its premise does not hold. A premise reads the runtime's own
 * model: the value axes the series are measured on, their range, scale and direction.
 */
const PREMISES = {
	// Bars cut short: drawn on a range without zero, or from a base other than zero.
	VIS_BAR_BASELINE: ({ bars }) => bars.some(({ min, max, log, fromZero }) => !log && (min > 0 || max < 0 || !fromZero)),
	VIS_BAR_LOG_SCALE: ({ bars }) => bars.some(({ log }) => log),
	VIS_REVERSED_VALUE_AXIS: ({ valueAxes }) => valueAxes.some(({ reversed }) => reversed),
	VIS_DUAL_AXIS: ({ valueAxes }) => new Set(valueAxes.map(({ id }) => id)).size >= 2,
	// A pie that does not show its values as given: a slice drawn for a negative value, or one left out.
	VIS_PIE_NEGATIVE: ({ pieMisdrawn }) => pieMisdrawn,
	// A drawn title whose text appears nowhere in the config: the library supplied it.
	VIS_PLACEHOLDER_TEXT: ({ title, valueAxes, config }) =>
		[title, ...valueAxes.map((axis) => axis.title)].some((text) => text !== '' && !JSON.stringify(config).includes(JSON.stringify(text))),
	VIS_VALUE_AXIS_UNTITLED: ({ title, valueAxes }) => title === '' && valueAxes.some((axis) => axis.title === ''),
	// Two cartesian series the runtime drew in one colour.
	VIS_SAME_COLOR_SERIES: ({ colors }) => new Set(colors.map(colorKey)).size < colors.length,
	// Nothing in the chart describes its data to assistive technology (undefined: not measured here).
	VIS_DATA_NOT_DESCRIBED: ({ described }) => (described === undefined ? undefined : !described),
	// Keyboard access the library gives, turned off: nothing takes focus.
	VIS_KEYBOARD_DISABLED: ({ keyboardOff }) => keyboardOff === true,
	// A cartesian series drawn below 3:1 against the background the browser computed (undefined: page shows through).
	// Motion that runs forever, or longer than five seconds, as the runtime resolves it.
	VIS_LONG_MOTION: ({ motion }) => (motion === undefined ? undefined : motion.endless || motion.longest > 5000),
	VIS_LOW_CONTRAST_SERIES: ({ contrasts }) => (contrasts === undefined ? undefined : contrasts.some((ratio) => ratio !== undefined && ratio < 3)),
	// A percent-stacked axis whose drawn tick labels and title show no % (undefined: no percent stacking in the library).
	VIS_PERCENT_WITHOUT_UNIT: ({ valueAxes }) =>
		valueAxes.some(({ percent }) => percent === undefined) ? undefined : valueAxes.some(({ percent, labels, title }) => percent && ![...labels, title].some((text) => text.includes('%')))
};

function checkPremises(findings, built, where) {
	const codes = new Set(findings.map((finding) => finding.split(' ')[0]));
	for (const [code, premise] of Object.entries(PREMISES)) {
		const holds = premise(built);
		if (holds !== undefined) assert.equal(holds, codes.has(code), `${where}: ${code}`);
	}
}

/** The value scales Chart.js built for the datasets, and whether an arc was drawn for a negative value. */
function builtChartjs(config) {
	const chart = createChartjs(copyPlain(config));
	try {
		const metas = chart.data.datasets.map((_, index) => chart.getDatasetMeta(index));
		const cartesian = metas.filter(({ vScale }) => vScale !== undefined);
		const drawn = ({ display, text }) => (display ? [text].flat().join(' ') : '');
		// Chart.js draws a bar from the pixel of its base value (zero unless `base` is set), even off the chart area, aligned to half a pixel.
		const fromZero = (meta) => meta.type !== 'bar' || meta.data.every(({ base }) => !Number.isFinite(base) || Math.abs(base - meta.vScale.getPixelForValue(0)) <= 1);
		const axis = (meta) => ({ id: meta.vScale.id, min: meta.vScale.min, max: meta.vScale.max, log: meta.vScale.type === 'logarithmic', reversed: meta.vScale.options.reverse === true, title: drawn(meta.vScale.options.title), fromZero: fromZero(meta) });
		const arcs = metas.filter(({ type }) => type === 'pie' || type === 'doughnut');
		const pieMisdrawn = arcs.some((meta) => meta._parsed.some((value, index) => value < 0 && meta.data[index].circumference > 0));
		const title = drawn(chart.options.plugins.title);
		const motion = chartjsMotion(chart, config);
		const colors = cartesian.map((meta) => (meta.type === 'line' ? meta.dataset.options.borderColor : meta.data[0].options.backgroundColor));
		return { motion, colors, bars: cartesian.filter(({ type }) => type === 'bar').map(axis), valueAxes: cartesian.map(axis), pieMisdrawn, title, config };
	} finally {
		chart.destroy();
	}
}

/** The value axes echarts built for its grid series. */
function builtEcharts(option, browserOutcome) {
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
				const title = axis.model.get('show') === false ? '' : (axis.model.get('name') ?? '');
				const data = model.getData();
				const color = data.getVisual('style')[data.getVisual('drawType')];
				// A bar's layout starts at its base along the value axis (`y` for vertical bars, `x` for horizontal ones).
				const zero = axis.toGlobalCoord(axis.dataToCoord(0));
				const fromZero = model.subType !== 'bar' || data.mapArray((index) => data.getItemLayout(index)?.[axis.dim]).every((base) => !Number.isFinite(base) || Math.abs(base - zero) < 0.5);
				return { type: model.subType, id: `${axis.dim}${String(axis.model.componentIndex)}`, min, max, log: axis.type === 'log', reversed: axis.inverse === true, title, color, fromZero };
			});
		// echarts filters negative pie values out before drawing (`negativeDataFilter`).
		const pies = chart.getModel().getSeries().filter((model) => model.subType === 'pie');
		const pieMisdrawn = pies.some((model) => model.getData().count() < model.getRawData().count());
		const component = chart.getModel().getComponent('title');
		const title = component === undefined || component.get('show') === false ? '' : (component.get('text') ?? '');
		const described = browserOutcome === undefined ? undefined : browserOutcome.label !== '';
		const background = chart.getModel().get('backgroundColor');
		const motion = echartsMotion(chart);
		const contrasts = typeof background === 'string' && background !== 'transparent' ? measured.map(({ color }) => contrastRatio(color, background)) : undefined;
		return { bars: measured.filter(({ type }) => type === 'bar'), valueAxes: measured, pieMisdrawn, title, config: option, colors: measured.map(({ color }) => color), described, contrasts, motion };
	} finally {
		chart.dispose();
	}
}

/** The y axes Highcharts built for its series (recorded by the page runner). */
function builtHighcharts({ series, yAxes, title, access, shades, durations }, config) {
	const measured = series
		.filter(({ yAxis }) => yAxis !== null)
		.map(({ type, yAxis, fromZero }) => ({ type, id: yAxis, ...yAxes[yAxis], fromZero: fromZero !== false }));
	// Highcharts leaves negative pie points out (`isValid`: `y >= 0`).
	const pieMisdrawn = series.some(({ type, points }) => type === 'pie' && points.some(({ y, valid }) => y !== null && y < 0 && !valid));
	const colors = series.filter(({ type, yAxis }) => type !== 'pie' && yAxis !== null).map(({ color }) => color);
	const cartesian = series.map(({ type, yAxis }, index) => (type !== 'pie' && yAxis !== null ? index : -1)).filter((index) => index >= 0);
	const contrasts = ['light', 'dark'].flatMap((scheme) => cartesian.map((index) => contrastRatio(shades[scheme].series[index] ?? '', shades[scheme].background)));
	// The harness loads the accessibility module: keyboard focus is there unless the config turns it off.
	return { bars: measured.filter(({ type }) => type === 'column' || type === 'bar'), valueAxes: measured, pieMisdrawn, title, config, colors, described: access.points > 0, keyboardOff: !access.keyboard, contrasts, motion: { endless: false, longest: Math.max(0, ...durations) } };
}

const run = (config, render) => verdictOf(render(copyPlain(config)));

const browser = { skip: browserSkipReason() ?? false };
// What assistive technology gets from echarts needs a DOM: every echarts case also runs in headless Chrome.
const echartsEntries = RULES_CONTRACT.filter((entry) => entry.echarts !== undefined);
const echartsAccess = browser.skip === false ? await runEchartsInBrowser(echartsEntries.map((entry) => entry.echarts.config)) : [];

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
			checkPremises(findings, builtEcharts(config, echartsAccess[echartsEntries.indexOf(entry)]), entry.name);
		});
}

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
		checkPremises(findings, builtHighcharts(outcomes[index].observed, config), entry.name);
	});
});
