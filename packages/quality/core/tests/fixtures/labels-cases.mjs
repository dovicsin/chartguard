import { cjBars, ecBars, hcBars } from './charts.mjs';

/** The rules contract's cases about titles and labels (CG-05-04 part 3); they set their own titles. */
export const LABEL_CASES = [
	{
		name: 'an empty title',
		labels: true,
		chartjs: {
			config: {
				...cjBars([1, 2], { title: { display: true, text: 'Units' } }),
				options: {
					scales: { y: { title: { display: true, text: 'Units' } } },
					plugins: { title: { display: true, text: '' } }
				}
			},
			findings: ['VIS_EMPTY_TITLE $.options.plugins.title.text']
		},
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), title: { text: '' } },
			findings: ['VIS_EMPTY_TITLE $.title.text']
		},
		highcharts: {
			config: { ...hcBars([1, 2], { title: { text: 'Units' } }), title: { text: '' } },
			findings: ['VIS_EMPTY_TITLE $.title.text']
		}
	},
	{
		name: "the library's placeholder titles",
		labels: true,
		highcharts: {
			config: hcBars([1, 2], {}),
			findings: ['VIS_PLACEHOLDER_TEXT $.title.text', 'VIS_PLACEHOLDER_TEXT $.yAxis.title.text']
		}
	},
	{
		name: 'placeholder titles without any options: Highcharts still creates its y axis',
		labels: true,
		highcharts: {
			config: { series: [{ type: 'column', data: [1, 2] }] },
			findings: ['VIS_PLACEHOLDER_TEXT $.title.text', 'VIS_PLACEHOLDER_TEXT $.yAxis.title.text']
		}
	},
	{
		name: 'counterexample: the chart sets the y axis title through its language options',
		labels: true,
		highcharts: {
			config: { ...hcBars([1, 2], {}), title: { text: 'Quarterly sales' }, lang: { yAxisTitle: 'Units' } },
			findings: []
		}
	},
	{
		name: 'no title names the quantity: neither the chart nor its value axis',
		labels: true,
		chartjs: { config: cjBars([1, 2], {}), findings: ['VIS_VALUE_AXIS_UNTITLED $.options.scales.y.title.text'] },
		echarts: { config: ecBars([1, 2], {}), findings: ['VIS_VALUE_AXIS_UNTITLED $.yAxis.name'] },
		highcharts: {
			config: { ...hcBars([1, 2], { title: { text: null } }), title: { text: null } },
			findings: ['VIS_VALUE_AXIS_UNTITLED $.yAxis.title.text']
		}
	},
	{
		name: 'counterexample: a chart title can carry the quantity',
		labels: true,
		chartjs: {
			config: { ...cjBars([1, 2], {}), options: { plugins: { title: { display: true, text: 'Sales (units)' } } } },
			findings: []
		},
		echarts: { config: { ...ecBars([1, 2], {}), title: { text: 'Sales (units)' } }, findings: [] },
		highcharts: {
			config: { ...hcBars([1, 2], { title: { text: null } }), title: { text: 'Sales (units)' } },
			findings: []
		}
	},
	{
		name: 'counterexample: a scale title that is set but not displayed shows nothing',
		labels: true,
		chartjs: {
			config: { ...cjBars([1, 2], { title: { text: 'Units' } }) },
			findings: ['VIS_VALUE_AXIS_UNTITLED $.options.scales.y.title.text']
		}
	}
];
