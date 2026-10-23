/**
 * The rules contract's unknown cases about labels, accessibility, motion and units (CG-05-05), and the
 * counterexamples the first parts left out.
 */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

/** An object whose `key` is behind a getter returning `value` (never run by the adapters). */
const getter = (key, value, rest = {}) =>
	Object.defineProperty({ ...rest }, key, { get: () => value, enumerable: true });

const line = (config) => ({ ...config, type: 'line' });

export const UNKNOWN_LABEL_CASES = [
	{
		name: 'unknown: a y axis title from a language text of a shape not read',
		rule: 'placeholder-text',
		kind: 'unknown',
		labels: true,
		highcharts: { config: { ...hcBars([1, 2], {}), title: { text: 'Sales' }, lang: { yAxisTitle: 5 } }, findings: [] }
	},
	{
		name: 'unknown: whether a y axis is visible, behind a getter',
		rule: 'placeholder-text',
		kind: 'unknown',
		labels: true,
		highcharts: { config: { ...hcBars([1, 2], getter('visible', false, {})), title: { text: 'Sales' } }, findings: [] }
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
