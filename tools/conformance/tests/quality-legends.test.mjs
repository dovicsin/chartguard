import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { normalize as normalizeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason, dumpDom } from '../../shared/chrome.mjs';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';
import { echartsLegend } from '../lib/quality-built.mjs';

/**
 * Legend entries against the runtimes (CG-05-04 part 9): for every series of the rules contract and of
 * the cases below, a known `legend.shown` is whether the pinned runtime drew an entry for that series,
 * and the known text of a drawn entry is the text it drew.
 */
const contract = (library) =>
	RULES_CONTRACT.filter((entry) => entry[library] !== undefined).map((entry) => entry[library].config);
const browser = { skip: browserSkipReason() ?? false };

/** Checks every known legend fact of `series` against `drawn(index)`: the text drawn for that series, or undefined. */
function checkEntries(series, drawn, where) {
	if (!series.known) return 0;
	let checked = 0;
	series.items.forEach(({ legend: { text, shown } }, index) => {
		const entry = drawn(index);
		if (shown.known) {
			assert.equal(entry !== undefined, shown.value, `${where} series ${String(index)}: shown`);
			checked += 1;
		}
		if (shown.known && shown.value && text.known)
			assert.equal(entry, text.value, `${where} series ${String(index)}: text`);
	});
	return checked;
}

const unlabelled = { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }, { label: 'S', data: [2] }] } };
const CHARTJS = [
	unlabelled,
	{ ...unlabelled, options: { plugins: { legend: { display: false } } } },
	{ ...unlabelled, options: { plugins: { legend: false } } },
	{ ...unlabelled, options: { plugins: false } },
	{ ...unlabelled, type: 'pie' },
	{ ...unlabelled, type: 'polarArea' },
	{ ...unlabelled, type: 'line', data: { labels: ['a'], datasets: [{ type: 'pie', data: [1] }] } }
];

test('Chart.js: every known legend entry is the one Chart.js draws, with its text', () => {
	let checked = 0;
	for (const config of [...contract('chartjs'), ...CHARTJS]) {
		const chart = createChartjs(copyPlain(config));
		try {
			const displayed = chart.legend !== undefined && chart.legend.options.display === true;
			const items = displayed ? chart.legend.legendItems : [];
			const drawn = (index) => {
				const item = items.find(({ datasetIndex }) => datasetIndex === index);
				return item === undefined ? undefined : String(item.text);
			};
			checked += checkEntries(normalizeChartjs(config).series, drawn, JSON.stringify(config));
		} finally {
			chart.destroy();
		}
	}
	assert.ok(checked > 50, String(checked));
});

test('Chart.js passes a missing label to the canvas as is, which draws it as "undefined"', async (context) => {
	const chart = createChartjs(copyPlain(unlabelled));
	try {
		assert.ok(chart.canvas.texts.includes(undefined));
		assert.ok(chart.canvas.texts.includes('S'));
	} finally {
		chart.destroy();
	}
	if (browser.skip !== false) return context.skip(browser.skip);
	// A canvas converts the text it fills to a string (WebIDL DOMString): `undefined` is the word.
	const page = `<!doctype html><body><script>const c = document.createElement('canvas').getContext('2d'); document.body.textContent = String(c.measureText(undefined).width > 0 && c.measureText(undefined).width === c.measureText('undefined').width);</script>`;
	assert.match(await dumpDom(`data:text/html,${encodeURIComponent(page)}`), /<body>true<\/body>/);
});

const ecBars = (series, extra = {}) => ({
	xAxis: { type: 'category', data: ['a'] },
	yAxis: {},
	series: [{ type: 'bar', data: [1], ...series }],
	...extra
});
const ECHARTS = [
	ecBars({}, { legend: {} }),
	ecBars({ name: 'S' }, { legend: {} }),
	ecBars({ name: 'S' }),
	ecBars({ name: 'S' }, { legend: { show: false } }),
	ecBars({ name: 'S' }, { legend: [{ show: false }, {}] }),
	ecBars({}, { legend: { data: ['series\u00000'] } }),
	{ legend: {}, series: [{ type: 'pie', name: 'S', data: [{ name: 'a', value: 1 }] }] }
];

test('echarts: every known legend entry is one echarts draws, with its text; an unnamed series has none', () => {
	let checked = 0;
	for (const option of [...contract('echarts'), ...ECHARTS]) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(option));
			const listed = new Set(echartsLegend(chart));
			const drawn = (index) => {
				const [model] = chart.getModel().queryComponents({ mainType: 'series', index });
				const own = model.legendVisualProvider?.getAllNames().length > 0 ? undefined : model.name;
				return own !== undefined && listed.has(own) ? own : undefined;
			};
			checked += checkEntries(normalizeEcharts(option).series, drawn, JSON.stringify(option));
		} finally {
			chart.dispose();
		}
	}
	assert.ok(checked > 50, String(checked));
});

const column = { type: 'column', data: [1] };
const HIGHCHARTS = [
	{ series: [column, { ...column, name: 'S' }, { ...column, name: null }] },
	{ legend: { enabled: false }, series: [column] },
	{ series: [{ ...column, showInLegend: false }, column] },
	{ plotOptions: { series: { showInLegend: false } }, series: [column] },
	{
		series: [
			{ ...column, name: 'S' },
			{ ...column, linkedTo: ':previous' }
		]
	},
	{ series: [{ type: 'pie', data: [1] }] },
	{ chart: { type: 'bar' }, series: [{ data: [1] }, { type: 'line', data: [2] }] }
];

test('Highcharts: every known legend entry is one Highcharts draws, with its text', browser, async () => {
	const configs = [...contract('highcharts'), ...HIGHCHARTS];
	const outcomes = await runHighcharts(configs.map((config) => ({ config })));
	let checked = 0;
	configs.forEach((config, index) => {
		const { legend } = outcomes[index].observed;
		const drawn = (at) => legend.find(({ series }) => series === at)?.text;
		checked += checkEntries(normalizeHighcharts(config).series, drawn, JSON.stringify(config));
	});
	assert.ok(checked > 50, String(checked));
});
