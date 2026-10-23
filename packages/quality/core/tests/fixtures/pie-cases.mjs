/** The rules contract's cases about pie values (CG-05-04 part 2). */
export const PIE_CASES = [
	{
		name: 'a negative value in a pie',
		rule: 'pie-negative',
		kind: 'triggers',
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
		rule: 'pie-negative',
		kind: 'counterexample',
		chartjs: {
			config: { type: 'pie', data: { labels: ['a', 'b', 'c'], datasets: [{ data: [3, 0, 2] }] } },
			findings: []
		},
		echarts: { config: { series: [{ type: 'pie', data: [3, 0, 2] }] }, findings: [] },
		highcharts: { config: { series: [{ type: 'pie', data: [3, 0, 2] }] }, findings: [] }
	}
];
