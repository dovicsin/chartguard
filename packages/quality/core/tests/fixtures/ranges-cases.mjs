/**
 * The rules contract's cases for ranges fitted to the data, bar bases and units (CG-05-04 part 8):
 * per rule a chart that triggers it and counterexamples, for each library that can express it.
 */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

/** Highcharts columns stacked as percentages, on an axis titled without a unit. */
const percent = (yAxis) => ({
	chart: { type: 'column' },
	xAxis: { categories: LABELS },
	yAxis: { title: { text: 'Share of sales' }, ...yAxis },
	plotOptions: { series: { stacking: 'percent' } },
	series: [{ data: [60, 70] }, { data: [40, 30] }]
});

export const RANGE_CASES = [
	{
		name: 'bars on a range fitted to the data that leaves zero out at every size',
		chartjs: {
			config: cjBars([60, 70], { beginAtZero: false }),
			findings: ['VIS_BAR_BASELINE $.options.scales.y.beginAtZero']
		},
		echarts: { config: ecBars([60, 70], { scale: true }), findings: ['VIS_BAR_BASELINE $.yAxis.scale'] }
	},
	{
		name: 'counterexample: a range fitted to data close to zero keeps zero at every size',
		chartjs: { config: cjBars([5, 70], { beginAtZero: false }), findings: [] },
		echarts: { config: ecBars([5, 70], { scale: true }), findings: [] }
	},
	{
		name: 'bars growing from a base other than zero',
		chartjs: {
			config: {
				...cjBars([60, 70], {}),
				data: { labels: LABELS, datasets: [{ label: 'Sales', data: [60, 70], base: 20 }] }
			},
			findings: ['VIS_BAR_BASELINE $.data.datasets[0].base']
		},
		echarts: { config: ecBars([60, 70], { startValue: 20 }), findings: ['VIS_BAR_BASELINE $.yAxis.startValue'] },
		highcharts: {
			config: { ...hcBars([60, 70], {}), series: [{ data: [60, 70], threshold: 20 }] },
			findings: ['VIS_BAR_BASELINE $.series[0].threshold']
		}
	},
	{
		name: 'counterexample: a base of zero set explicitly',
		chartjs: {
			config: {
				...cjBars([60, 70], {}),
				data: { labels: LABELS, datasets: [{ label: 'Sales', data: [60, 70], base: 0 }] }
			},
			findings: []
		},
		echarts: { config: ecBars([60, 70], { startValue: 0 }), findings: [] },
		highcharts: { config: { ...hcBars([60, 70], {}), series: [{ data: [60, 70], threshold: 0 }] }, findings: [] }
	},
	{
		name: 'shares stacked to 100 on an axis that shows no percent sign',
		highcharts: { config: percent({}), findings: ['VIS_PERCENT_WITHOUT_UNIT $.yAxis.labels.format'] }
	},
	{
		name: 'counterexample: percent-stacked shares labelled with a percent sign',
		highcharts: { config: percent({ labels: { format: '{value}%' } }), findings: [] }
	}
];
