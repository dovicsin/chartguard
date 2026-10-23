import assert from 'node:assert/strict';
import test from 'node:test';

import * as echarts from 'echarts';

import { normalize as normalizeChartjs } from '../../../packages/quality/chartjs/dist/index.js';
import { RULES_CONTRACT } from '../../../packages/quality/core/tests/fixtures/rules-contract.mjs';
import { SEMANTICS_CONTRACT } from '../../../packages/quality/core/tests/fixtures/semantics-contract.mjs';
import { normalize as normalizeEcharts } from '../../../packages/quality/echarts/dist/index.js';
import { normalize as normalizeHighcharts } from '../../../packages/quality/highcharts/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { createChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runHighcharts } from '../lib/highcharts.mjs';

/**
 * The value facts against the runtimes (CG-05-04 part 2): every known summary (count, smallest,
 * largest) is what the pinned runtime reads from the same data, before it draws anything.
 */
const configs = (library) =>
	[...SEMANTICS_CONTRACT, ...RULES_CONTRACT].flatMap((entry) => {
		const config = entry[library];
		if (config === undefined) return [];
		return [{ name: entry.name, config: 'config' in config ? config.config : config }];
	});

/** The summary of the values a runtime read, in the facts' terms. */
function summary(values) {
	const read = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
	return read.length === 0 ? { count: 0 } : { count: read.length, min: Math.min(...read), max: Math.max(...read) };
}

function agree(chart, readBy, where) {
	chart.series.items.forEach(({ values }, index) => {
		if (!values.known) return;
		const { count, min, max } = values.value;
		const expected = count === 0 ? { count } : { count, min: min.value, max: max.value };
		assert.deepEqual(expected, summary(readBy(index)), `${where} series ${String(index)}`);
	});
}

test('Chart.js: every known value summary is what the controllers parse', () => {
	for (const { name, config } of configs('chartjs')) {
		const chart = createChartjs(copyPlain(config));
		try {
			agree(
				normalizeChartjs(config),
				(index) => {
					const meta = chart.getDatasetMeta(index);
					return meta._parsed.map((parsed) => (typeof parsed === 'number' ? parsed : parsed?.[meta.vScale?.axis]));
				},
				name
			);
		} finally {
			chart.destroy();
		}
	}
});

test('ECharts: every known value summary is what the series data holds before filtering', () => {
	for (const { name, config } of configs('echarts')) {
		const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
		try {
			chart.setOption(copyPlain(config));
			const models = chart.getModel().getSeries();
			agree(
				normalizeEcharts(config),
				(index) => {
					const model = models[index];
					const raw = model.getRawData();
					const system = model.coordinateSystem;
					const dimension =
						system?.type === 'cartesian2d'
							? raw.mapDimension(system.getOtherAxis(system.getBaseAxis()).dim)
							: raw.mapDimension('value');
					const values = [];
					raw.each(dimension, (value) => values.push(value));
					return values;
				},
				name
			);
		} finally {
			chart.dispose();
		}
	}
});

const browser = { skip: browserSkipReason() ?? false };

test('Highcharts: every known value summary is the y of the points the chart built', browser, async () => {
	const cases = configs('highcharts');
	const outcomes = await runHighcharts(cases.map(({ config }) => ({ config })));
	cases.forEach(({ name, config }, position) => {
		const { observed } = outcomes[position];
		agree(normalizeHighcharts(config), (index) => observed.series[index].points.map(({ y }) => y), name);
	});
});
