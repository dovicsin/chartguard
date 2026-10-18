/** Stand-in for `new echarts.graphic.LinearGradient(0, 0, 0, 1, stops)`: a class instance with own data properties. */
class LinearGradient {
	constructor(colorStops) {
		Object.assign(this, { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops, global: false });
	}
}

/**
 * Options shaped after the official Apache ECharts 6 examples (echarts.apache.org/examples).
 * Each one renders on the pinned runtime without errors or warnings (tools/conformance).
 */
export const KNOWN_VALID = {
	'line-simple': {
		xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
		yAxis: { type: 'value' },
		series: [{ data: [150, 230, 224], type: 'line' }]
	},
	'area-smooth': {
		xAxis: { type: 'category', boundaryGap: false, data: ['a', 'b'] },
		yAxis: { type: 'value' },
		series: [{ data: [820, 932], type: 'line', smooth: true, areaStyle: {}, symbol: 'none' }]
	},
	'bar-background': {
		xAxis: { type: 'category', data: ['Mon'] },
		yAxis: { type: 'value' },
		series: [{ data: [120], type: 'bar', showBackground: true, backgroundStyle: { color: 'rgba(180, 180, 180, 0.2)' } }]
	},
	'pie-simple': {
		title: { text: 'Referer', subtext: 'Fake Data', left: 'center' },
		tooltip: { trigger: 'item' },
		legend: { orient: 'vertical', left: 'left' },
		series: [
			{
				name: 'Access From',
				type: 'pie',
				radius: '50%',
				data: [{ value: 1048, name: 'Search Engine' }],
				emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' } }
			}
		]
	},
	doughnut: {
		series: [
			{
				type: 'pie',
				radius: ['40%', '70%'],
				itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
				label: { show: false, position: 'center' },
				labelLine: { show: false },
				data: [{ value: 1, name: 'a' }]
			}
		]
	},
	candlestick: {
		xAxis: { data: ['2017-10-24'] },
		yAxis: {},
		series: [{ type: 'candlestick', data: [[20, 34, 10, 38]] }]
	},
	gauge: {
		tooltip: { formatter: '{a} <br/>{b} : {c}%' },
		series: [
			{ name: 'Pressure', type: 'gauge', detail: { formatter: '{value}' }, data: [{ value: 50, name: 'SCORE' }] }
		]
	},
	radar: {
		radar: { indicator: [{ name: 'Sales', max: 6500 }] },
		series: [{ type: 'radar', data: [{ value: [4200], name: 'Allocated Budget' }] }]
	},
	heatmap: {
		grid: { height: '50%', top: '10%' },
		visualMap: { min: 0, max: 10, calculable: true, orient: 'horizontal', left: 'center', bottom: '15%' },
		xAxis: { type: 'category', data: ['12a'], splitArea: { show: true } },
		yAxis: { type: 'category', data: ['Sat'], splitArea: { show: true } },
		series: [{ name: 'Punch Card', type: 'heatmap', data: [[0, 0, 5]], label: { show: true } }]
	},
	'dataset-encode': {
		dataset: {
			source: [
				['score', 'amount', 'product'],
				[89.3, 58212, 'Matcha Latte']
			]
		},
		grid: { containLabel: true },
		xAxis: { name: 'amount' },
		yAxis: { type: 'category' },
		series: [{ type: 'bar', encode: { x: 'amount', y: 'product' } }]
	},
	graph: {
		series: [
			{
				type: 'graph',
				layout: 'force',
				roam: true,
				force: { repulsion: 100 },
				data: [{ name: 'a', symbolSize: 10 }],
				links: [{ source: 'a', target: 'a' }]
			}
		]
	},
	treemap: { series: [{ type: 'treemap', data: [{ name: 'A', value: 10, children: [{ name: 'Aa', value: 4 }] }] }] },
	'single-series-object': {
		series: { type: 'sankey', emphasis: { focus: 'adjacency' }, data: [{ name: 'a' }], links: [] }
	},
	'time-axis-boolean-boundary-gap': {
		tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
		xAxis: { type: 'time', boundaryGap: false },
		yAxis: { type: 'value', boundaryGap: [0, '100%'] },
		series: [{ type: 'line', smooth: true, symbol: 'none', areaStyle: {}, data: [[1, 2]] }]
	},
	'mark-line-point': {
		xAxis: { type: 'category', data: ['a'] },
		yAxis: { type: 'value', axisLabel: { formatter: '{value} °C' } },
		series: [
			{
				type: 'line',
				data: [10],
				markPoint: { data: [{ type: 'max', name: 'Max' }] },
				markLine: { data: [{ type: 'average', name: 'Avg' }] }
			}
		]
	},
	callbacks: {
		tooltip: { trigger: 'axis', formatter: (params) => String(params) },
		xAxis: { type: 'category', data: ['a'], axisLabel: { formatter: (value) => value, rotate: 45 } },
		yAxis: { type: 'value' },
		series: [{ type: 'bar', data: [1], itemStyle: { color: (params) => (params.dataIndex > 0 ? 'red' : 'blue') } }]
	},
	'gradient-instance': {
		xAxis: { type: 'category', data: ['a'] },
		yAxis: { type: 'value' },
		series: [
			{
				type: 'bar',
				data: [1],
				itemStyle: { color: new LinearGradient([{ offset: 0, color: '#83bff6' }]) }
			}
		]
	},
	'rich-text': {
		series: [
			{
				type: 'pie',
				data: [{ value: 1, name: 'a' }],
				label: {
					formatter: '{a|{a}}\n{hr|}',
					rich: { a: { color: '#6E7079', align: 'center' }, hr: { width: '100%' } }
				}
			}
		]
	},
	'timeline-options': {
		baseOption: {
			timeline: { axisType: 'category', autoPlay: true, data: ['2002', '2003'] },
			xAxis: { type: 'category' },
			yAxis: { type: 'value' },
			series: [{ type: 'bar' }]
		},
		options: [{ series: [{ data: [1] }] }]
	},
	media: {
		baseOption: { series: [{ type: 'pie' }] },
		media: [{ query: { maxWidth: 500 }, option: { series: [{ radius: [20, '50%'] }] } }]
	},
	'multiple-grids': {
		grid: [
			{ left: '7%', width: '38%' },
			{ right: '7%', width: '38%' }
		],
		xAxis: [{ gridIndex: 0 }, { gridIndex: 1 }],
		yAxis: [{ gridIndex: 0 }, { gridIndex: 1 }],
		series: [{ type: 'scatter', xAxisIndex: 1, yAxisIndex: 1, data: [[1, 2]] }]
	},
	'polar-bar': {
		angleAxis: { max: 2, startAngle: 75 },
		radiusAxis: { type: 'category', data: ['a'] },
		polar: {},
		series: { type: 'bar', data: [2], coordinateSystem: 'polar', label: { show: true, position: 'middle' } }
	},
	'custom-series': {
		xAxis: {},
		yAxis: {},
		series: [
			{ type: 'custom', renderItem: () => ({ type: 'rect', shape: { x: 0, y: 0, width: 1, height: 1 } }), data: [[1]] }
		]
	},
	'animation-callbacks': {
		animationDuration: 1000,
		animationEasing: 'elasticOut',
		animationDelay: (index) => index * 10,
		xAxis: { type: 'category', data: ['a'] },
		yAxis: { type: 'value' },
		series: [{ type: 'bar', data: [1] }]
	},
	graphic: { graphic: [{ type: 'text', left: 'center', top: 'center', style: { text: 'ECharts', fontSize: 80 } }] },
	'typed-array-data': {
		xAxis: { type: 'value' },
		yAxis: { type: 'value' },
		series: [{ type: 'scatter', large: true, data: new Float32Array([1, 2, 3, 4]), dimensions: ['x', 'y'] }]
	},
	'typed-array-dataset': {
		dataset: { source: new Float64Array([1, 2]), dimensions: ['v'] },
		xAxis: { type: 'category' },
		yAxis: { type: 'value' },
		series: [{ type: 'line' }]
	},
	'date-values': {
		xAxis: { type: 'time', min: new Date(2020, 0, 1), max: '2021-01-01' },
		yAxis: { type: 'value' },
		series: [{ type: 'line', data: [[new Date(2020, 0, 2), 3]] }]
	}
};
