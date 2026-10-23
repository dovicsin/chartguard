/**
 * The rules contract's unknown cases (CG-05-05): per rule a chart whose deciding fact the adapter cannot
 * know (behind a getter, decided by a function, of a shape not read, or depending on the size or on the
 * page), so it claims nothing, whatever the runtime then draws. The premise of the case's rule is not
 * compared; every other rule's is.
 */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

/** An object whose `key` is behind a getter returning `value` (never run by the adapters). */
const getter = (key, value, rest = {}) =>
	Object.defineProperty({ ...rest }, key, { get: () => value, enumerable: true });
/** An array whose element `index` is behind a getter. */
const hidden = (values, index) =>
	Object.defineProperty([...values], String(index), { get: () => values[index], enumerable: true });

const line = (config) => ({ ...config, type: 'line' });

export const UNKNOWN_CASES = [
	{
		name: 'unknown: a fitted range that depends on the size, an axis minimum decided by a function, no threshold',
		rule: 'bar-baseline',
		kind: 'unknown',
		chartjs: { config: cjBars([30, 100], { beginAtZero: false }), findings: [] },
		echarts: { config: ecBars([60, 70], { min: () => 50 }), findings: [] },
		highcharts: { config: { ...hcBars([60, 70], {}), plotOptions: { column: { threshold: null } } }, findings: [] }
	},
	{
		name: 'unknown: a y axis minimum Highcharts rounds down to a tick the plot size decides',
		rule: 'bar-baseline',
		kind: 'unknown',
		// With data from 60 to 100 the tick below 5 is 0: Highcharts draws the columns from zero (H7).
		highcharts: { config: hcBars([60, 100], { min: 5 }), findings: [] }
	},
	{
		name: 'unknown: a fitted range without the series the legend hides',
		rule: 'bar-baseline',
		kind: 'unknown',
		// echarts fits the axis to the bars alone (60 to 70); the hidden line's values are not modelled (K11).
		echarts: {
			config: {
				...ecBars([60, 70], { scale: true }),
				series: [
					{ type: 'bar', data: [60, 70] },
					{ type: 'line', name: 'Low', data: [1, 2] }
				],
				legend: { selected: { Low: false } }
			},
			findings: []
		}
	},
	{
		name: 'unknown: a logarithmic scale type behind a getter',
		rule: 'bar-log-scale',
		kind: 'unknown',
		chartjs: { config: cjBars([10, 1000], getter('type', 'logarithmic')), findings: [] },
		echarts: { config: ecBars([10, 1000], getter('type', 'log')), findings: [] }
	},
	{
		name: 'unknown: a reversal behind a getter',
		rule: 'reversed-value-axis',
		kind: 'unknown',
		chartjs: { config: line(cjBars([1, 2], getter('reverse', true))), findings: [] },
		echarts: {
			config: { ...ecBars([1, 2], getter('inverse', true)), series: [{ type: 'line', data: [1, 2] }] },
			findings: []
		}
	},
	{
		name: 'unknown: the second value axis a series is bound to behind a getter',
		rule: 'dual-axis',
		kind: 'unknown',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'Revenue', data: [5, 7] },
						getter('yAxisID', 'y1', { type: 'line', label: 'Margin', data: [20, 25] })
					]
				},
				options: { scales: { y: {}, y1: { position: 'right' } } }
			},
			findings: []
		},
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: [{}, {}],
				series: [{ type: 'bar', data: [5, 7] }, getter('yAxisIndex', 1, { type: 'line', data: [20, 25] })]
			},
			findings: []
		}
	},
	{
		name: 'unknown: a negative pie value behind a getter',
		rule: 'pie-negative',
		kind: 'unknown',
		chartjs: {
			config: { type: 'pie', data: { labels: ['a', 'b', 'c'], datasets: [{ data: hidden([3, -1, 2], 1) }] } },
			findings: []
		},
		echarts: { config: { series: [{ type: 'pie', data: hidden([3, -1, 2], 1) }] }, findings: [] }
	},
	{
		name: 'unknown: series colours decided by functions',
		rule: 'same-color-series',
		kind: 'unknown',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'A', data: [1, 2], backgroundColor: () => '#36a2eb' },
						{ label: 'B', data: [2, 3], backgroundColor: () => '#36a2eb' }
					]
				}
			},
			findings: []
		},
		echarts: {
			config: {
				...ecBars([1, 2], {}),
				series: [
					{ type: 'bar', name: 'A', data: [1, 2], itemStyle: { color: () => '#5470c6' } },
					{ type: 'bar', name: 'B', data: [2, 3], itemStyle: { color: () => '#5470c6' } }
				]
			},
			findings: []
		}
	},
	{
		name: 'unknown: colours the Colors plugin forces over, whether or not it is registered',
		rule: 'same-color-series',
		kind: 'unknown',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'A', data: [1, 2], backgroundColor: '#ff0000' },
						{ label: 'B', data: [2, 3], backgroundColor: '#f00' }
					]
				},
				options: { plugins: { colors: { forceOverride: true } } }
			},
			findings: []
		}
	},
	{
		name: 'unknown: light series on a page that shows through, its background not declared',
		rule: 'low-contrast-series',
		kind: 'unknown',
		contrast: true,
		chartjs: {
			config: {
				...cjBars([1, 2], {}),
				data: { labels: LABELS, datasets: [{ label: 'Sales', data: [1, 2], backgroundColor: '#eeeeee' }] }
			},
			findings: []
		},
		echarts: {
			config: { ...ecBars([1, 2], {}), series: [{ type: 'bar', itemStyle: { color: '#eeeeee' }, data: [1, 2] }] },
			findings: []
		},
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				chart: { type: 'column', backgroundColor: 'transparent' },
				series: [{ data: [1, 2], color: '#eeeeee' }]
			},
			findings: []
		}
	}
];
