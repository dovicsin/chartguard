/**
 * The rule catalog's cross-library fixtures (CG-05-04): per rule a chart that triggers it and
 * counterexamples that must not, written for each library where the library can express it, with
 * the findings each adapter must report. tools/conformance renders every config on its pinned
 * runtime and checks the premise of each finding on what the runtime built (the bars' axis range
 * excludes zero, the axis is logarithmic or reversed, two value axes are in use).
 */
import { ACCESS_CASES } from './access-cases.mjs';
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';
import { COLOR_CASES } from './colors-cases.mjs';
import { CONTRAST_CASES } from './contrast-cases.mjs';
import { LABEL_CASES } from './labels-cases.mjs';

const CASES = [
	{
		name: 'bars on an axis starting above zero',
		chartjs: { config: cjBars([60, 70], { min: 50 }), findings: ['VIS_BAR_BASELINE $.options.scales.y.min'] },
		echarts: { config: ecBars([60, 70], { min: 50 }), findings: ['VIS_BAR_BASELINE $.yAxis.min'] },
		highcharts: { config: hcBars([60, 70], { min: 50 }), findings: ['VIS_BAR_BASELINE $.yAxis.min'] }
	},
	{
		name: 'counterexample: a negative minimum keeps zero in range, bars start from zero',
		chartjs: { config: cjBars([60, 70], { min: -10 }), findings: [] },
		echarts: { config: ecBars([60, 70], { min: -10 }), findings: [] },
		highcharts: { config: hcBars([60, 70], { min: -10 }), findings: [] }
	},
	{
		name: 'negative bars on an axis ending below zero',
		chartjs: { config: cjBars([-60, -70], { max: -50 }), findings: ['VIS_BAR_BASELINE $.options.scales.y.max'] },
		echarts: { config: ecBars([-60, -70], { max: -50 }), findings: ['VIS_BAR_BASELINE $.yAxis.max'] },
		highcharts: { config: hcBars([-60, -70], { max: -50 }), findings: ['VIS_BAR_BASELINE $.yAxis.max'] }
	},
	{
		name: 'bars on an axis starting at the data minimum',
		echarts: { config: ecBars([60, 70], { min: 'dataMin' }), findings: ['VIS_BAR_BASELINE $.yAxis.min'] }
	},
	{
		name: 'counterexample: a line on an axis starting above zero',
		chartjs: { config: { ...cjBars([60, 70], { min: 50 }), type: 'line' }, findings: [] },
		echarts: { config: { ...ecBars([60, 70], { min: 50 }), series: [{ type: 'line', data: [60, 70] }] }, findings: [] },
		highcharts: { config: { ...hcBars([60, 70], { min: 50 }), chart: { type: 'line' } }, findings: [] }
	},
	{
		name: 'bars on a logarithmic axis',
		chartjs: {
			config: cjBars([10, 1000], { type: 'logarithmic' }),
			findings: ['VIS_BAR_LOG_SCALE $.options.scales.y.type']
		},
		echarts: { config: ecBars([10, 1000], { type: 'log' }), findings: ['VIS_BAR_LOG_SCALE $.yAxis.type'] },
		highcharts: { config: hcBars([10, 1000], { type: 'logarithmic' }), findings: ['VIS_BAR_LOG_SCALE $.yAxis.type'] }
	},
	{
		name: 'a reversed value axis',
		chartjs: {
			config: { ...cjBars([1, 2], { reverse: true }), type: 'line' },
			findings: ['VIS_REVERSED_VALUE_AXIS $.options.scales.y.reverse']
		},
		echarts: {
			config: { ...ecBars([1, 2], { inverse: true }), series: [{ type: 'line', data: [1, 2] }] },
			findings: ['VIS_REVERSED_VALUE_AXIS $.yAxis.inverse']
		},
		highcharts: {
			config: { ...hcBars([1, 2], { reversed: true }), chart: { type: 'line' } },
			findings: ['VIS_REVERSED_VALUE_AXIS $.yAxis.reversed']
		}
	},
	{
		name: 'counterexample: a reversed category axis of horizontal bars is not a value axis',
		chartjs: { config: cjBars([1, 2], { reverse: true }, { indexAxis: 'y' }), findings: [] },
		echarts: {
			config: {
				xAxis: { type: 'value' },
				yAxis: { type: 'category', data: LABELS, inverse: true },
				series: [{ type: 'bar', data: [1, 2] }]
			},
			findings: []
		},
		highcharts: {
			config: { chart: { type: 'bar' }, xAxis: { categories: LABELS, reversed: true }, series: [{ data: [1, 2] }] },
			findings: []
		}
	},
	{
		name: 'bars and a line on two value axes',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'Revenue', data: [5, 7] },
						{ type: 'line', label: 'Margin', data: [20, 25], yAxisID: 'y1' }
					]
				},
				options: { scales: { y: {}, y1: { position: 'right' } } }
			},
			findings: ['VIS_DUAL_AXIS $.data.datasets[1].yAxisID']
		},
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: [{}, {}],
				series: [
					{ type: 'bar', data: [5, 7] },
					{ type: 'line', data: [20, 25], yAxisIndex: 1 }
				]
			},
			findings: ['VIS_DUAL_AXIS $.series[1].yAxisIndex']
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				yAxis: [{}, { opposite: true }],
				series: [
					{ type: 'column', data: [5, 7] },
					{ type: 'line', data: [20, 25], yAxis: 1 }
				]
			},
			findings: ['VIS_DUAL_AXIS $.series[1].yAxis']
		}
	},
	{
		name: 'counterexample: two series on one value axis',
		chartjs: {
			config: { type: 'bar', data: { labels: LABELS, datasets: [{ data: [5, 7] }, { type: 'line', data: [6, 8] }] } },
			findings: []
		},
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: {},
				series: [
					{ type: 'bar', data: [5, 7] },
					{ type: 'line', data: [6, 8] }
				]
			},
			findings: []
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				series: [
					{ type: 'column', data: [5, 7] },
					{ type: 'line', data: [6, 8] }
				]
			},
			findings: []
		}
	},
	{
		name: 'a negative value in a pie',
		chartjs: {
			config: { type: 'pie', data: { labels: ['a', 'b', 'c'], datasets: [{ data: [3, -1, 2] }] } },
			findings: ['VIS_PIE_NEGATIVE $.data.datasets[0].data[1]']
		},
		echarts: {
			config: {
				series: [
					{
						type: 'pie',
						data: [
							{ name: 'a', value: 3 },
							{ name: 'b', value: -1 },
							{ name: 'c', value: 2 }
						]
					}
				]
			},
			findings: ['VIS_PIE_NEGATIVE $.series[0].data[1].value']
		},
		highcharts: {
			config: {
				series: [
					{
						type: 'pie',
						data: [
							['a', 3],
							['b', -1],
							['c', 2]
						]
					}
				]
			},
			findings: ['VIS_PIE_NEGATIVE $.series[0].data[1][1]']
		}
	},
	{
		name: 'counterexample: a pie of positive values and a zero',
		chartjs: {
			config: { type: 'pie', data: { labels: ['a', 'b', 'c'], datasets: [{ data: [3, 0, 2] }] } },
			findings: []
		},
		echarts: { config: { series: [{ type: 'pie', data: [3, 0, 2] }] }, findings: [] },
		highcharts: { config: { series: [{ type: 'pie', data: [3, 0, 2] }] }, findings: [] }
	}
];

/**
 * Every case that is not about labels gets the titles a real chart has (a chart title, and a title on
 * each y axis): without them, the label rules would add their findings to every case.
 */
const TITLE = 'Quarterly sales';
const yTitled = (yAxis) =>
	Array.isArray(yAxis) ? yAxis.map(yTitled) : { ...yAxis, title: { text: 'Units', ...yAxis?.title } };
const TITLED = {
	chartjs: (config) => ({
		...config,
		options: { ...config.options, plugins: { title: { display: true, text: TITLE }, ...config.options?.plugins } }
	}),
	echarts: (option) => ({ title: { text: TITLE }, ...option }),
	highcharts: (config) => ({ title: { text: TITLE }, ...config, yAxis: yTitled(config.yAxis ?? {}) })
};

/**
 * Every case that is not about accessibility is an accessible chart: ECharts describes its data only
 * with `aria`; Highcharts's default colours fall below 3:1 on white, so it gets colours with 3:1 on
 * both its light and dark backgrounds.
 */
const ACCESSIBLE_COLORS = [
	'#1f77b4',
	'#d62728',
	'#2ca02c',
	'#9467bd',
	'#8c564b',
	'#7f7f7f',
	'#3366cc',
	'#dc3912',
	'#109618',
	'#0099c6'
];
const DESCRIBED = (key, option) => (key === 'echarts' ? { aria: { enabled: true }, ...option } : option);
const CONTRASTED = (key, config) =>
	key === 'highcharts' ? { palette: { colors: ACCESSIBLE_COLORS }, ...config } : config;

/**
 * A case as a real chart would be written: titled unless it is about labels, described to assistive
 * technology unless it is about access, in colours with contrast unless it is about contrast.
 */
function realistic(entry) {
	const config = (key, value) => {
		const titled = entry.labels === true ? value : TITLED[key](value);
		const described = entry.access === true ? titled : DESCRIBED(key, titled);
		return entry.contrast === true ? described : CONTRASTED(key, described);
	};
	return Object.fromEntries(
		Object.entries(entry).map(([key, value]) =>
			key in TITLED ? [key, { ...value, config: config(key, value.config) }] : [key, value]
		)
	);
}

export const RULES_CONTRACT = [...CASES, ...COLOR_CASES, ...CONTRAST_CASES, ...LABEL_CASES, ...ACCESS_CASES].map(
	realistic
);
