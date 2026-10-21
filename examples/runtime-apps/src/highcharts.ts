import { createValidator } from '@chartguard/config-highcharts';
import { addSeries, createChart, update } from '@chartguard/runtime-highcharts';
import Highcharts from 'highcharts/highcharts.src.js';

import { box, runApp, type Seen, seen } from './report.js';

/**
 * The full schema the application generated locally from its installed highcharts (never shipped,
 * CG-01-05); the page provides it. Without it, the shipped curated subset checks the options.
 */
const artifact: unknown = (globalThis as { chartguardHighchartsSchema?: unknown }).chartguardHighchartsSchema;

runApp(() => {
	const results: Seen[] = [];
	const guard = {
		...(artifact === undefined ? {} : { validator: createValidator(artifact) }),
		block: true,
		onResult: (result: Parameters<typeof seen>[1], { phase }: { phase: string }) => results.push(seen(phase, result))
	};
	const { chart } = createChart(
		Highcharts,
		box('div'),
		{ chart: { type: 'column' }, title: { text: 'Visits' }, series: [{ data: [1, 2, 3] }] },
		guard
	);
	if (chart === undefined) throw new Error('the valid chart was not created');
	// An update item is checked as the column series it changes: pointPadding must be a number.
	update(chart, { series: [{ pointPadding: 'wide' }] }, {}, guard);
	update(chart, { series: [{ pointPadding: 0.2 }] }, {}, guard);
	addSeries(chart, { data: [3, 2, 1] }, {}, guard);
	// A sankey series without the sankey module: Highcharts would throw error #17; it is blocked.
	const sankey = createChart(
		Highcharts,
		box('div'),
		{ series: [{ type: 'sankey', keys: ['from', 'to', 'weight'], data: [['a', 'b', 1]] }] },
		guard
	);
	const state = {
		series: chart.series.map(
			(series) => `${String(series.type)} ${String((series.options as { pointPadding?: unknown }).pointPadding)}`
		),
		sankey: sankey.chart === undefined
	};
	chart.destroy();
	return { library: 'highcharts', results, ...state };
});
