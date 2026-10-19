/**
 * Like RUNTIME_CONTRACT, for deprecated options (CG-02-06): each case pins the deprecation finding
 * and how echarts 6.1.0 reacts. The runtime warns for the options its backward-compat preprocessor
 * renames; it is silent for options only the declarations deprecate.
 */
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };

export const DEPRECATIONS_CONTRACT = [
	{
		name: 'line clipOverflow',
		config: { ...axes, series: [{ type: 'line', data: [1], clipOverflow: false }] },
		findings: ['warning CFG_DEPRECATED $.series[0].clipOverflow'],
		runtime: 'complained'
	},
	{
		name: 'pie clockWise',
		config: { series: [{ type: 'pie', data: [1, 2], clockWise: false }] },
		findings: ['warning CFG_DEPRECATED $.series[0].clockWise'],
		runtime: 'complained'
	},
	{
		name: 'bar itemStyle barBorderRadius',
		config: { ...axes, series: [{ type: 'bar', data: [1], itemStyle: { barBorderRadius: 4 } }] },
		findings: ['warning CFG_DEPRECATED $.series[0].itemStyle.barBorderRadius'],
		runtime: 'complained'
	},
	{
		name: 'pie label margin with edge alignment',
		config: { series: [{ type: 'pie', data: [1, 2], label: { alignTo: 'edge', margin: 8 } }] },
		findings: ['warning CFG_DEPRECATED $.series[0].label.margin'],
		runtime: 'complained'
	},
	{
		name: 'pie label margin without edge alignment',
		config: { series: [{ type: 'pie', data: [1, 2], label: { margin: 8 } }] },
		findings: ['warning CFG_DEPRECATED $.series[0].label.margin'],
		runtime: 'accepted',
		why: 'Deprecated: the declarations deprecate `label.margin` (use `edgeDistance`); the runtime renames and warns only with `alignTo: "edge"`.'
	},
	{
		name: 'radar indicator text',
		config: {
			radar: {
				indicator: [
					{ text: 'A', max: 10 },
					{ name: 'B', max: 10 },
					{ name: 'C', max: 10 }
				]
			},
			series: [{ type: 'radar', data: [{ value: [1, 2, 3] }] }]
		},
		findings: ['warning CFG_DEPRECATED $.radar.indicator[0].text'],
		runtime: 'complained'
	},
	{
		name: 'current names',
		config: {
			...axes,
			series: [
				{ type: 'line', data: [1], clip: false },
				{ type: 'bar', data: [1], itemStyle: { borderRadius: 4 } }
			]
		},
		findings: [],
		runtime: 'accepted'
	}
];
