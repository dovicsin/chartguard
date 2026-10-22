import { ecBars, hcBars, LABELS } from './charts.mjs';

/** The rules contract's contrast cases (CG-05-04 part 6); they choose their own colours. */
const TITLE = { text: 'Quarterly sales' };

export const CONTRAST_CASES = [
	{
		name: "Highcharts's default colours on its light and dark backgrounds",
		contrast: true,
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: TITLE,
				series: [
					{ type: 'column', data: [1, 2] },
					{ type: 'line', data: [2, 3] }
				]
			},
			// #2caffe is 2.42:1 on white; the line's colour is #544fc5 in light and #00e272 in dark, both with contrast.
			findings: ['VIS_LOW_CONTRAST_SERIES $.series[0].color']
		}
	},
	{
		name: 'a translucent series on an opaque background',
		contrast: true,
		echarts: {
			config: {
				...ecBars([1, 2], { name: 'Units' }),
				title: TITLE,
				backgroundColor: '#ffffff',
				series: [{ type: 'bar', itemStyle: { color: 'rgba(0, 0, 0, 0.1)' }, data: [1, 2] }]
			},
			findings: ['VIS_LOW_CONTRAST_SERIES $.series[0].itemStyle.color']
		},
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: TITLE,
				series: [{ type: 'column', color: 'rgba(0, 0, 0, 0.1)', data: [1, 2] }]
			},
			findings: ['VIS_LOW_CONTRAST_SERIES $.series[0].color']
		}
	},
	{
		name: 'counterexample: a page showing through, or colours with contrast',
		contrast: true,
		echarts: {
			config: {
				...ecBars([1, 2], { name: 'Units' }),
				title: TITLE,
				series: [{ type: 'bar', itemStyle: { color: '#eeeeee' }, data: [1, 2] }]
			},
			findings: []
		},
		highcharts: {
			config: {
				...hcBars([1, 2], { title: { text: 'Units' } }),
				title: TITLE,
				xAxis: { categories: LABELS },
				chart: { type: 'column', backgroundColor: '#222222' },
				series: [{ color: '#ffcc00', data: [1, 2] }]
			},
			findings: []
		}
	}
];
