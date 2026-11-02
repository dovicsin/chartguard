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
		name: 'bar emphasis itemStyle barBorderRadius (compatBarItemStyle(seriesOpt.emphasis))',
		config: { ...axes, series: [{ type: 'bar', data: [1], emphasis: { itemStyle: { barBorderColor: 'red' } } }] },
		findings: ['warning CFG_DEPRECATED $.series[0].emphasis.itemStyle.barBorderColor'],
		runtime: 'complained'
	},
	{
		name: 'bar data item itemStyle and emphasis itemStyle barBorder* (compatBarItemStyle(data[i]))',
		config: {
			...axes,
			series: [
				{
					type: 'bar',
					data: [{ value: 1, itemStyle: { barBorderWidth: 2 }, emphasis: { itemStyle: { barBorderRadius: 4 } } }]
				}
			]
		},
		findings: [
			'warning CFG_DEPRECATED $.series[0].data[0].itemStyle.barBorderWidth',
			'warning CFG_DEPRECATED $.series[0].data[0].emphasis.itemStyle.barBorderRadius'
		],
		runtime: 'complained'
	},
	{
		name: 'bar backgroundStyle barBorderRadius: compatBarItemStyle(seriesOpt.backgroundStyle) renames only inside backgroundStyle.itemStyle',
		config: {
			...axes,
			series: [{ type: 'bar', data: [1], showBackground: true, backgroundStyle: { barBorderRadius: 4 } }]
		},
		findings: ['warning CFG_UNKNOWN_KEY $.series[0].backgroundStyle.barBorderRadius'],
		runtime: 'accepted',
		why: 'Unresolved: the runtime ignores the unknown key; its rename reads `backgroundStyle.itemStyle`, which the bar background does not use.'
	},
	{
		name: 'sunburst downplay, on the series and on a nested node (compatSunburstState)',
		config: {
			series: [
				{
					type: 'sunburst',
					downplay: { itemStyle: { opacity: 0.5 } },
					data: [
						{ name: 'a', value: 1, children: [{ name: 'b', value: 1, downplay: { itemStyle: { opacity: 0.2 } } }] }
					]
				}
			]
		},
		findings: [
			'warning CFG_DEPRECATED $.series[0].downplay',
			'warning CFG_DEPRECATED $.series[0].data[0].children[0].downplay'
		],
		runtime: 'complained'
	},
	{
		name: 'sunburst highlightPolicy',
		config: { series: [{ type: 'sunburst', highlightPolicy: 'ancestor', data: [{ name: 'a', value: 1 }] }] },
		findings: ['warning CFG_DEPRECATED $.series[0].highlightPolicy'],
		runtime: 'complained'
	},
	{
		name: 'pie hoverAnimation (copied into emphasis.scale for every series type)',
		config: { series: [{ type: 'pie', data: [1, 2], hoverAnimation: false }] },
		findings: ['warning CFG_DEPRECATED $.series[0].hoverAnimation'],
		runtime: 'complained'
	},
	{
		name: 'gauge pointer.color: the gauge rename is unreachable (the pie/gauge branch is taken first)',
		config: { series: [{ type: 'gauge', data: [1], pointer: { color: 'red' } }] },
		findings: ['warning CFG_UNKNOWN_KEY $.series[0].pointer.color'],
		runtime: 'accepted',
		why: "Unresolved: the runtime ignores the unknown key; `else if (seriesType === 'gauge')` follows `seriesType === 'pie' || seriesType === 'gauge'`, so `pointer.color` is never copied, and GaugeView reads `pointer.itemStyle`."
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
