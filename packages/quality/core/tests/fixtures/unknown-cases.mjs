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
	},
	{
		name: 'unknown: a y axis title from a language text of a shape not read',
		rule: 'placeholder-text',
		kind: 'unknown',
		labels: true,
		highcharts: { config: { ...hcBars([1, 2], {}), title: { text: 'Sales' }, lang: { yAxisTitle: 5 } }, findings: [] }
	},
	{
		name: 'unknown: whether a scale title is displayed, behind a getter',
		rule: 'value-axis-untitled',
		kind: 'unknown',
		labels: true,
		chartjs: { config: cjBars([1, 2], { title: getter('display', false, { text: 'Units' }) }), findings: [] }
	},
	{
		name: 'unknown: a title text behind a getter',
		rule: 'empty-title',
		kind: 'unknown',
		labels: true,
		chartjs: {
			config: cjBars(
				[1, 2],
				{ title: { display: true, text: 'Units' } },
				{ plugins: { title: getter('text', '', { display: true }) } }
			),
			findings: []
		}
	},
	{
		name: 'unknown: a canvas whose page is not declared, aria behind a getter',
		rule: 'data-not-described',
		kind: 'unknown',
		access: true,
		chartjs: { config: cjBars([1, 2], {}), findings: [] },
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), title: { text: 'Sales' }, aria: getter('enabled', false) },
			findings: []
		}
	},
	{
		name: 'unknown: a keyboard switch of a shape not read',
		rule: 'keyboard-disabled',
		kind: 'unknown',
		access: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: { text: 'Sales' },
				accessibility: { keyboardNavigation: { enabled: 'no' } }
			},
			findings: []
		}
	},
	{
		name: 'unknown: animation durations decided by functions',
		rule: 'long-motion',
		kind: 'unknown',
		chartjs: { config: cjBars([1, 2], {}, { animation: { duration: () => 6000 } }), findings: [] },
		echarts: { config: { ...ecBars([1, 2], { name: 'Units' }), animationDuration: () => 6000 }, findings: [] }
	},
	{
		name: 'unknown: a percent axis label format with a placeholder not read',
		rule: 'percent-without-unit',
		kind: 'unknown',
		highcharts: {
			config: {
				chart: { type: 'column' },
				xAxis: { categories: LABELS },
				yAxis: { title: { text: 'Share of sales' }, labels: { format: 'Share {pos}' } },
				plotOptions: { series: { stacking: 'percent' } },
				series: [{ data: [60, 70] }, { data: [40, 30] }]
			},
			findings: []
		}
	}
];

/** Counterexamples the first parts left out (CG-05-05 completes every rule). */
export const MORE_COUNTEREXAMPLES = [
	{
		name: 'counterexample: lines on a logarithmic axis',
		rule: 'bar-log-scale',
		kind: 'counterexample',
		chartjs: { config: line(cjBars([10, 1000], { type: 'logarithmic' })), findings: [] },
		echarts: {
			config: { ...ecBars([10, 1000], { type: 'log' }), series: [{ type: 'line', data: [10, 1000] }] },
			findings: []
		},
		highcharts: { config: { ...hcBars([10, 1000], { type: 'logarithmic' }), chart: { type: 'line' } }, findings: [] }
	},
	{
		name: 'counterexample: Highcharts keyboard navigation turned on',
		rule: 'keyboard-disabled',
		kind: 'counterexample',
		access: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: { text: 'Sales' },
				accessibility: { keyboardNavigation: { enabled: true } }
			},
			findings: []
		}
	}
];
