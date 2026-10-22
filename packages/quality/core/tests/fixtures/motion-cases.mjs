import { cjBars, ecBars, hcBars } from './charts.mjs';

/** The rules contract's motion cases (CG-05-04 part 7). */
export const MOTION_CASES = [
	{
		name: 'an animation that loops forever',
		chartjs: {
			config: cjBars([1, 2], {}, { animation: { loop: true } }),
			findings: ['VIS_LONG_MOTION $.options.animation.loop']
		}
	},
	{
		name: 'a ripple effect that never stops, even with animation off',
		echarts: {
			config: {
				...ecBars([1, 2], { name: 'Units' }),
				animation: false,
				series: [{ type: 'effectScatter', data: [1, 2] }]
			},
			findings: ['VIS_LONG_MOTION $.series[0].showEffectOn']
		}
	},
	{
		name: 'an animation longer than five seconds',
		chartjs: {
			config: cjBars([1, 2], {}, { animation: { duration: 6000 } }),
			findings: ['VIS_LONG_MOTION $.options.animation.duration']
		},
		echarts: {
			config: { ...ecBars([1, 2], { name: 'Units' }), animationDuration: 6000 },
			findings: ['VIS_LONG_MOTION $.animationDuration']
		},
		highcharts: {
			config: { ...hcBars([1, 2], {}), plotOptions: { series: { animation: { duration: 6000 } } } },
			findings: ['VIS_LONG_MOTION $.plotOptions.series.animation.duration']
		}
	},
	{
		name: 'counterexample: a ripple only on hover, and animations under five seconds',
		chartjs: { config: cjBars([1, 2], {}, { animation: { duration: 4000 } }), findings: [] },
		echarts: {
			config: {
				...ecBars([1, 2], { name: 'Units' }),
				series: [{ type: 'effectScatter', showEffectOn: 'emphasis', data: [1, 2] }]
			},
			findings: []
		},
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				plotOptions: { series: { animation: false } },
				series: [{ animation: { defer: 100 }, data: [1, 2] }]
			},
			findings: []
		}
	}
];
