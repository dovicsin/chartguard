import { LABELS } from './charts.mjs';

/** The rules contract's colour cases (CG-05-04 part 4). */
const series = (count) => Array.from({ length: count }, (_, index) => index + 1);

export const COLOR_CASES = [
	{
		name: 'one colour written twice, in two notations',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'a', data: [1, 2], backgroundColor: '#336699' },
						{ label: 'b', data: [2, 3], backgroundColor: 'rgb(51, 102, 153)' }
					]
				}
			},
			findings: ['VIS_SAME_COLOR_SERIES $.data.datasets[1].backgroundColor']
		},
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: {},
				series: [
					{ type: 'bar', itemStyle: { color: '#336699' }, data: [1, 2] },
					{ type: 'bar', itemStyle: { color: '#369' }, data: [2, 3] }
				]
			},
			findings: ['VIS_SAME_COLOR_SERIES $.series[1].itemStyle.color']
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				series: [
					{ type: 'column', color: '#336699', data: [1, 2] },
					{ type: 'column', color: '#369', data: [2, 3] }
				]
			},
			findings: ['VIS_SAME_COLOR_SERIES $.series[1].color']
		}
	},
	{
		name: "Chart.js's own grey for every dataset without a colour, once one has a colour",
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'a', data: [1, 2], backgroundColor: '#336699' },
						{ label: 'b', data: [2, 3] },
						{ label: 'c', data: [3, 4] }
					]
				}
			},
			findings: ['VIS_SAME_COLOR_SERIES $.data.datasets[2].backgroundColor']
		}
	},
	{
		name: 'more series than palette colours: the palette wraps around',
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: {},
				series: series(10).map((value) => ({ type: 'line', data: [value, value + 1] }))
			},
			findings: ['VIS_SAME_COLOR_SERIES $.series[9].itemStyle.color']
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				series: series(11).map((value) => ({ type: 'line', data: [value, value + 1] }))
			},
			findings: ['VIS_SAME_COLOR_SERIES $.series[10].color']
		}
	},
	{
		name: 'two series of one name share their palette colour',
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: {},
				series: [
					{ type: 'line', name: 'Sales', data: [1, 2] },
					{ type: 'line', name: 'Sales', data: [2, 3] }
				]
			},
			findings: ['VIS_SAME_COLOR_SERIES $.series[1].itemStyle.color']
		}
	},
	{
		name: 'counterexample: distinct colours, and a palette long enough',
		chartjs: {
			config: {
				type: 'bar',
				data: {
					labels: LABELS,
					datasets: [
						{ label: 'a', data: [1, 2], backgroundColor: '#336699' },
						{ label: 'b', data: [2, 3], backgroundColor: '#993366' }
					]
				}
			},
			findings: []
		},
		echarts: {
			config: {
				xAxis: { type: 'category', data: LABELS },
				yAxis: {},
				series: series(9).map((value) => ({ type: 'line', data: [value, value + 1] }))
			},
			findings: []
		},
		highcharts: {
			config: {
				xAxis: { categories: LABELS },
				series: series(10).map((value) => ({ type: 'line', data: [value, value + 1] }))
			},
			findings: []
		}
	}
];
