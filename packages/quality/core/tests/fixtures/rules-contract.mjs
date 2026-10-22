/**
 * The rule catalog's cross-library fixtures (CG-05-04): per rule a chart that triggers it and
 * counterexamples that must not, written for each library where the library can express it, with
 * the findings each adapter must report. tools/conformance renders every config on its pinned
 * runtime and checks the premise of each finding on what the runtime built (the bars' axis range
 * excludes zero, the axis is logarithmic or reversed, two value axes are in use).
 */
const LABELS = ['Q1', 'Q2'];
const cjBars = (data, scale, extra = {}) => ({
	type: 'bar',
	data: { labels: LABELS, datasets: [{ label: 'Sales', data }] },
	options: { scales: { y: scale }, ...extra }
});
const ecBars = (data, yAxis) => ({ xAxis: { type: 'category', data: LABELS }, yAxis, series: [{ type: 'bar', data }] });
const hcBars = (data, yAxis) => ({
	chart: { type: 'column' },
	xAxis: { categories: LABELS },
	yAxis,
	series: [{ data }]
});

export const RULES_CONTRACT = [
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
		name: 'an empty title',
		chartjs: {
			config: { ...cjBars([1, 2], {}), options: { plugins: { title: { display: true, text: '' } } } },
			findings: ['VIS_EMPTY_TITLE $.options.plugins.title.text']
		},
		echarts: { config: { ...ecBars([1, 2], {}), title: { text: '' } }, findings: ['VIS_EMPTY_TITLE $.title.text'] },
		highcharts: { config: { ...hcBars([1, 2], {}), title: { text: '' } }, findings: ['VIS_EMPTY_TITLE $.title.text'] }
	}
];
