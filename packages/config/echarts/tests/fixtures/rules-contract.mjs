/**
 * Like RUNTIME_CONTRACT, for the rules over several options at once (src/rules, CG-02-08): each
 * case pins the rule's findings and how echarts 6.1.0 reacts, so a rule never claims more than the
 * runtime does.
 */
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };
/** A heatmap on cartesian2d needs two category axes on band. */
const grid = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'category', data: ['b'] } };

export const RULES_CONTRACT = [
	{
		name: 'heatmap whose visualMap targets another series',
		config: {
			...grid,
			visualMap: { seriesIndex: 1, min: 0, max: 1 },
			series: [
				{ type: 'heatmap', data: [[0, 0, 1]] },
				{ type: 'line', data: [1] }
			]
		},
		findings: ['error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'heatmap with a visualMap',
		config: { ...grid, visualMap: { min: 0, max: 1 }, series: [{ type: 'heatmap', data: [[0, 0, 1]] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'heatmap on a value axis',
		config: { ...axes, visualMap: { min: 0, max: 1 }, series: [{ type: 'heatmap', data: [[0, 0, 1]] }] },
		findings: ['error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'heatmap on a category axis without boundary gap',
		config: {
			xAxis: { type: 'category', data: ['a'], boundaryGap: false },
			yAxis: { type: 'category', data: ['b'] },
			visualMap: { min: 0, max: 1 },
			series: [{ type: 'heatmap', data: [[0, 0, 1]] }]
		},
		findings: ['error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'heatmap whose y axis is category through its data',
		config: {
			xAxis: { data: ['a'] },
			yAxis: { data: ['b'] },
			visualMap: { min: 0, max: 1 },
			series: [{ type: 'heatmap', data: [[0, 0, 1]] }]
		},
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'series on an axis index that does not exist',
		config: { ...axes, series: [{ type: 'line', yAxisIndex: 1, data: [1] }] },
		findings: ['error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'custom series without axes',
		config: { series: [{ type: 'custom', renderItem: () => null, data: [1] }] },
		findings: ['error CFG_REQUIRES $.series[0]', 'error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'legend entry that names no series',
		config: { ...axes, legend: { data: ['Sales', 'Costs'] }, series: [{ name: 'Sales', type: 'line', data: [1] }] },
		findings: ['warning CFG_UNKNOWN_REFERENCE $.legend.data[1]'],
		runtime: 'complained'
	},
	{
		name: 'legend entries from pie data names',
		config: {
			legend: { data: ['A', 'B'] },
			series: [
				{
					type: 'pie',
					data: [
						{ name: 'A', value: 1 },
						{ name: 'B', value: 2 }
					]
				}
			]
		},
		findings: [],
		runtime: 'accepted'
	}
];
