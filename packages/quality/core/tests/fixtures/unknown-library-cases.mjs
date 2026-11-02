/**
 * The rules contract's unknown cases that complete every library (CG-05-05): for each rule a library
 * can express, a chart whose deciding fact that adapter cannot know, so it claims nothing.
 */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

/** An object whose `key` is behind a getter returning `value` (never run by the adapters). */
const getter = (key, value, rest = {}) =>
	Object.defineProperty({ ...rest }, key, { get: () => value, enumerable: true });
/** An array whose element `index` is behind a getter. */
const hidden = (values, index) =>
	Object.defineProperty([...values], String(index), { get: () => values[index], enumerable: true });

/** Highcharts: the second y axis a series is bound to, behind a getter. */
const onSecondAxis = (series) => getter('yAxis', 1, series);

export const UNKNOWN_LIBRARY_CASES = [
	{
		name: 'unknown: a minimum above zero on a scale whose type is behind a getter (it could be logarithmic)',
		rule: 'bar-baseline',
		kind: 'unknown',
		// Drawn linear here, the bars are cut short; a logarithmic type would make it a bar-log-scale case (A51).
		chartjs: { config: cjBars([60, 70], getter('type', 'linear', { min: 50 })), findings: [] },
		echarts: { config: ecBars([60, 70], getter('type', 'value', { min: 50 })), findings: [] }
	},
	{
		name: 'unknown: Highcharts bars bound to a logarithmic axis by an index behind a getter',
		rule: 'bar-log-scale',
		kind: 'unknown',
		highcharts: {
			config: { ...hcBars([10, 1000], [{}, { type: 'logarithmic' }]), series: [onSecondAxis({ data: [10, 1000] })] },
			findings: []
		}
	},
	{
		name: 'unknown: a Highcharts line bound to a reversed axis by an index behind a getter',
		rule: 'reversed-value-axis',
		kind: 'unknown',
		highcharts: {
			config: {
				...hcBars([1, 2], [{}, { reversed: true }]),
				chart: { type: 'line' },
				series: [onSecondAxis({ data: [1, 2] })]
			},
			findings: []
		}
	},
	{
		name: 'unknown: the second Highcharts y axis a series is bound to, behind a getter',
		rule: 'dual-axis',
		kind: 'unknown',
		highcharts: {
			config: {
				...hcBars([5, 7], [{}, { opposite: true }]),
				series: [{ data: [5, 7] }, onSecondAxis({ type: 'line', data: [20, 25] })]
			},
			findings: []
		}
	},
	{
		name: 'unknown: a negative Highcharts pie value behind a getter',
		rule: 'pie-negative',
		kind: 'unknown',
		highcharts: { config: { series: [{ type: 'pie', data: hidden([3, -1, 2], 1) }] }, findings: [] }
	},
	{
		name: 'unknown: a Highcharts series colour behind a getter',
		rule: 'same-color-series',
		kind: 'unknown',
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				series: [{ data: [1, 2], color: '#1f77b4' }, getter('color', '#1f77b4', { data: [2, 3] })]
			},
			findings: []
		}
	},
	{
		name: 'unknown: a light series on a grid that draws its own background',
		rule: 'low-contrast-series',
		kind: 'unknown',
		contrast: true,
		// The series is drawn on the black grid, not on the white chart background (A58).
		echarts: {
			config: {
				...ecBars([1, 2], {}),
				backgroundColor: '#ffffff',
				grid: [{ show: true, backgroundColor: '#000000' }],
				series: [{ type: 'bar', data: [1, 2], itemStyle: { color: '#eeeeee' } }]
			},
			findings: []
		}
	},
	{
		name: 'unknown: a chart title text behind a getter (ECharts, Highcharts)',
		rule: 'empty-title',
		kind: 'unknown',
		labels: true,
		echarts: { config: { ...ecBars([1, 2], { name: 'Units' }), title: getter('text', '') }, findings: [] },
		highcharts: {
			config: { ...hcBars([1, 2], { title: { text: 'Units' } }), title: getter('text', '') },
			findings: []
		}
	},
	{
		name: 'unknown: a value axis title behind a getter, the chart title hidden (ECharts, Highcharts)',
		rule: 'value-axis-untitled',
		kind: 'unknown',
		labels: true,
		echarts: { config: { ...ecBars([1, 2], getter('name', '')), title: { show: false } }, findings: [] },
		highcharts: {
			config: { ...hcBars([1, 2], { title: getter('text', '') }), title: { text: null } },
			findings: []
		}
	},
	{
		name: 'unknown: Highcharts accessibility switched by a getter',
		rule: 'data-not-described',
		kind: 'unknown',
		access: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: { text: 'Sales' },
				// Whichever way it switches, the adapter cannot tell; on, nothing else is claimed either.
				accessibility: getter('enabled', true)
			},
			findings: []
		}
	},
	{
		name: 'counterexample: Highcharts accessibility turned on describes the data',
		rule: 'data-not-described',
		kind: 'counterexample',
		access: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: { text: 'Sales' },
				accessibility: { enabled: true }
			},
			findings: []
		}
	},
	{
		name: 'unknown: a Highcharts series type behind a getter, so which plotOptions animate it',
		rule: 'long-motion',
		kind: 'unknown',
		highcharts: {
			config: {
				chart: { type: 'column' },
				xAxis: { categories: LABELS },
				plotOptions: { line: { animation: { duration: 6000 } } },
				series: [getter('type', 'line', { data: [1, 2] })]
			},
			findings: []
		}
	}
];
