/** The rules contract's cases about scales, baselines and pie values (CG-05-04 part 1 and 2). */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

export const SCALE_CASES = [
	{
		name: 'bars on an axis starting above zero',
		rule: 'bar-baseline',
		kind: 'triggers',
		chartjs: { config: cjBars([60, 70], { min: 50 }), findings: ['VIS_BAR_BASELINE $.options.scales.y.min'] },
		echarts: { config: ecBars([60, 70], { min: 50 }), findings: ['VIS_BAR_BASELINE $.yAxis.min'] },
		// Highcharts rounds a y axis bound to a tick unless startOnTick is off (H7).
		highcharts: {
			config: hcBars([60, 70], { min: 50, startOnTick: false }),
			findings: ['VIS_BAR_BASELINE $.yAxis.min']
		}
	},
	{
		name: 'counterexample: a negative minimum keeps zero in range, bars start from zero',
		rule: 'bar-baseline',
		kind: 'counterexample',
		chartjs: { config: cjBars([60, 70], { min: -10 }), findings: [] },
		echarts: { config: ecBars([60, 70], { min: -10 }), findings: [] },
		highcharts: { config: hcBars([60, 70], { min: -10 }), findings: [] }
	},
	{
		name: 'negative bars on an axis ending below zero',
		rule: 'bar-baseline',
		kind: 'triggers',
		chartjs: { config: cjBars([-60, -70], { max: -50 }), findings: ['VIS_BAR_BASELINE $.options.scales.y.max'] },
		echarts: { config: ecBars([-60, -70], { max: -50 }), findings: ['VIS_BAR_BASELINE $.yAxis.max'] },
		highcharts: {
			config: hcBars([-60, -70], { max: -50, endOnTick: false }),
			findings: ['VIS_BAR_BASELINE $.yAxis.max']
		}
	},
	{
		name: 'bars on an axis starting at the data minimum',
		rule: 'bar-baseline',
		kind: 'triggers',
		echarts: { config: ecBars([60, 70], { min: 'dataMin' }), findings: ['VIS_BAR_BASELINE $.yAxis.min'] }
	},
	{
		name: 'counterexample: an axis starting at the data minimum, below zero: the bars grow from zero',
		rule: 'bar-baseline',
		kind: 'counterexample',
		// A fix to `min: 0` would cut the negative bar off (H8).
		echarts: { config: ecBars([-5, 10], { min: 'dataMin' }), findings: [] }
	},
	{
		name: 'counterexample: a line on an axis starting above zero',
		rule: 'bar-baseline',
		kind: 'counterexample',
		chartjs: { config: { ...cjBars([60, 70], { min: 50 }), type: 'line' }, findings: [] },
		echarts: { config: { ...ecBars([60, 70], { min: 50 }), series: [{ type: 'line', data: [60, 70] }] }, findings: [] },
		highcharts: {
			config: { ...hcBars([60, 70], { min: 50, startOnTick: false }), chart: { type: 'line' } },
			findings: []
		}
	},
	{
		name: 'bars on a logarithmic axis',
		rule: 'bar-log-scale',
		kind: 'triggers',
		chartjs: {
			config: cjBars([10, 1000], { type: 'logarithmic' }),
			findings: ['VIS_BAR_LOG_SCALE $.options.scales.y.type']
		},
		echarts: { config: ecBars([10, 1000], { type: 'log' }), findings: ['VIS_BAR_LOG_SCALE $.yAxis.type'] },
		highcharts: { config: hcBars([10, 1000], { type: 'logarithmic' }), findings: ['VIS_BAR_LOG_SCALE $.yAxis.type'] }
	},
	{
		name: 'a reversed value axis',
		rule: 'reversed-value-axis',
		kind: 'triggers',
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
		rule: 'reversed-value-axis',
		kind: 'counterexample',
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
		rule: 'dual-axis',
		kind: 'triggers',
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
		name: 'counterexample: two value axes, each in a panel of its own',
		rule: 'dual-axis',
		kind: 'counterexample',
		// The layout the rule's message asks for: separate panels sharing the index axis (H9).
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
				options: { scales: { y: { stack: 'panels' }, y1: { stack: 'panels', offset: true } } }
			},
			findings: []
		},
		echarts: {
			config: {
				grid: [{ bottom: '55%' }, { top: '55%' }],
				xAxis: [
					{ type: 'category', data: LABELS, gridIndex: 0 },
					{ type: 'category', data: LABELS, gridIndex: 1 }
				],
				yAxis: [{ gridIndex: 0 }, { gridIndex: 1 }],
				series: [
					{ type: 'bar', data: [5, 7] },
					{ type: 'line', data: [20, 25], xAxisIndex: 1, yAxisIndex: 1 }
				]
			},
			findings: []
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				yAxis: [{ height: '45%' }, { top: '55%', height: '45%', offset: 0 }],
				series: [
					{ type: 'column', data: [5, 7] },
					{ type: 'line', data: [20, 25], yAxis: 1 }
				]
			},
			findings: []
		}
	},
	{
		name: 'counterexample: two series on one value axis',
		rule: 'dual-axis',
		kind: 'counterexample',
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
	}
];
