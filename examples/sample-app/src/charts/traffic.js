import * as echarts from 'echarts';

const option = {
	xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'], boundaryGap: 'yes' },
	yAxis: { type: 'value' },
	series: [{ type: 'line', data: [120, 200, 150] }]
};

export function mountTraffic(element) {
	const chart = echarts.init(element);
	chart.setOption(option);
	return chart;
}
