/**
 * The rules contract's context and setting cases (CG-05-05): what the caller declares about the page
 * (`options.context`) fills facts the chart leaves to it or meets a rule's concern; rule settings
 * (`options.rules`) turn a rule off, set its level, or ignore a finding at a path. A suppressed finding
 * is listed under `suppressed`; its premise must hold like a reported one's.
 */
import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

const LIGHT = '#eeeeee';
const WHITE_PAGE = { context: { background: '#ffffff' } };

export const CONTEXT_CASES = [
	{
		name: 'context: light series on a declared white page behind a chart that draws no background',
		rule: 'low-contrast-series',
		kind: 'context',
		contrast: true,
		chartjs: {
			config: {
				...cjBars([1, 2], {}),
				data: { labels: LABELS, datasets: [{ label: 'Sales', data: [1, 2], backgroundColor: LIGHT }] }
			},
			options: WHITE_PAGE,
			findings: ['VIS_LOW_CONTRAST_SERIES $.data.datasets[0].backgroundColor']
		},
		echarts: {
			config: { ...ecBars([1, 2], {}), series: [{ type: 'bar', itemStyle: { color: LIGHT }, data: [1, 2] }] },
			options: WHITE_PAGE,
			findings: ['VIS_LOW_CONTRAST_SERIES $.series[0].itemStyle.color']
		},
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				chart: { type: 'column', backgroundColor: 'transparent' },
				series: [{ data: [1, 2], color: LIGHT }]
			},
			options: WHITE_PAGE,
			findings: ['VIS_LOW_CONTRAST_SERIES $.series[0].color']
		}
	},
	{
		name: 'context: the same light series on a declared dark page have contrast',
		rule: 'low-contrast-series',
		kind: 'context',
		contrast: true,
		chartjs: {
			config: {
				...cjBars([1, 2], {}),
				data: { labels: LABELS, datasets: [{ label: 'Sales', data: [1, 2], backgroundColor: LIGHT }] }
			},
			options: { context: { background: { light: '#000000', dark: '#000000' } } },
			findings: []
		},
		echarts: {
			config: { ...ecBars([1, 2], {}), series: [{ type: 'bar', itemStyle: { color: LIGHT }, data: [1, 2] }] },
			options: { context: { background: '#000000' } },
			findings: []
		}
	},
	{
		name: 'context: a page that gives no description of a canvas chart',
		rule: 'data-not-described',
		kind: 'context',
		access: true,
		chartjs: {
			config: cjBars([1, 2], {}),
			options: { context: { describesData: false } },
			findings: ['VIS_DATA_NOT_DESCRIBED $'],
			declaredOnly: 'A canvas has no text alternative of its own; that the page gives none is what the caller declares.'
		}
	},
	{
		name: 'context: the page describes the data of a chart without aria',
		rule: 'data-not-described',
		kind: 'context',
		access: true,
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), title: { text: 'Sales' } },
			options: { context: { describesData: true } },
			findings: [],
			suppressed: ['VIS_DATA_NOT_DESCRIBED $.aria.enabled']
		}
	},
	{
		name: 'context: the page gives a control that pauses a looping animation',
		rule: 'long-motion',
		kind: 'context',
		chartjs: {
			config: cjBars([1, 2], {}, { animation: { loop: true } }),
			options: { context: { pausesMotion: true } },
			findings: [],
			suppressed: ['VIS_LONG_MOTION $.options.animation.loop']
		},
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), animationDuration: 6000 },
			options: { context: { pausesMotion: true } },
			findings: [],
			suppressed: ['VIS_LONG_MOTION $.animationDuration']
		}
	}
];

export const SETTING_CASES = [
	{
		name: 'setting: bars from 50 ignored at their axis, with the reason',
		rule: 'bar-baseline',
		kind: 'setting',
		chartjs: {
			config: cjBars([60, 70], { min: 50 }),
			options: {
				rules: {
					'bar-baseline': { ignore: [{ path: '$.options.scales.y', reason: 'A narrow band of stock prices.' }] }
				}
			},
			findings: [],
			suppressed: ['VIS_BAR_BASELINE $.options.scales.y.min']
		},
		echarts: {
			config: ecBars([60, 70], { min: 50 }),
			options: {
				rules: { 'bar-baseline': { ignore: [{ path: '$.yAxis.min', reason: 'A narrow band of stock prices.' }] } }
			},
			findings: [],
			suppressed: ['VIS_BAR_BASELINE $.yAxis.min']
		},
		highcharts: {
			config: hcBars([60, 70], { min: 50 }),
			options: {
				rules: {
					'bar-baseline': { level: 'info', ignore: [{ path: '$.yAxis', reason: 'A narrow band of stock prices.' }] }
				}
			},
			findings: [],
			suppressed: ['VIS_BAR_BASELINE $.yAxis.min']
		}
	},
	{
		name: 'setting: a rule turned off, and one reported as information',
		rule: 'bar-baseline',
		kind: 'setting',
		chartjs: { config: cjBars([60, 70], { min: 50 }), options: { rules: { 'bar-baseline': 'off' } }, findings: [] },
		echarts: {
			config: ecBars([60, 70], { min: 50 }),
			options: { rules: { 'bar-baseline': 'info' } },
			findings: ['VIS_BAR_BASELINE $.yAxis.min'],
			severity: 'info'
		}
	}
];
