/**
 * Options whose validator findings and runtime behaviour are both pinned. `findings` is every
 * diagnostic as `severity code path`; `runtime` is how echarts@6.1.0 reacts (tools/conformance):
 * `accepted` (renders silently), `complained` (renders with warnings) or `rejected` (throws or
 * logs an error). Wherever the two disagree, `why` says which kind of disagreement it is:
 *
 * - `Type contract:` we report a confirmed error for a value outside the declared closed type,
 *   and the runtime coerces or ignores it instead of failing.
 * - `Unresolved:` we report an unknown variant or key; the runtime needs an extension the
 *   harness does not register, or ignores the key.
 * - `False negative (CG-XX-YY):` we report nothing, the runtime rejects it; the roadmap item
 *   that will cover it is named.
 */
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };

export const RUNTIME_CONTRACT = [
	{
		name: 'axis type typo',
		config: { xAxis: { type: 'catgory' }, yAxis: { type: 'value' } },
		findings: ['error CFG_ENUM $.xAxis.type'],
		runtime: 'rejected'
	},
	{
		name: 'bar width boolean',
		config: { ...axes, series: [{ type: 'bar', data: [1], barWidth: true }] },
		findings: ['error CFG_TYPE $.series[0].barWidth'],
		runtime: 'accepted',
		why: 'Type contract: declared `number | string`; the runtime renders it without an error or warning.'
	},
	{
		name: 'smooth string',
		config: { ...axes, series: [{ type: 'line', data: [1], smooth: 'yes' }] },
		findings: ['error CFG_TYPE $.series[0].smooth'],
		runtime: 'accepted',
		why: 'Type contract: declared `boolean | number`; the runtime renders it without an error or warning.'
	},
	{
		name: 'symbol size word',
		config: { ...axes, series: { type: 'scatter', data: [[1, 2]], symbolSize: 'big' } },
		findings: ['error CFG_TYPE $.series.symbolSize'],
		runtime: 'accepted',
		why: 'Type contract: declared `number | number[] | callback`; the runtime renders it without an error or warning.'
	},
	{
		name: 'title text number',
		config: { title: { text: 42 } },
		findings: ['error CFG_TYPE $.title.text'],
		runtime: 'accepted',
		why: 'Type contract: declared `string`; the runtime renders it without an error or warning.'
	},
	{
		name: 'tooltip trigger value',
		config: { tooltip: { trigger: 'hover' } },
		findings: ['error CFG_ENUM $.tooltip.trigger'],
		runtime: 'accepted',
		why: "Type contract: declared `'item' | 'axis' | 'none'`; the runtime renders it without an error or warning."
	},
	{
		name: 'label position typo',
		config: { ...axes, series: [{ type: 'bar', data: [1], label: { show: true, position: 'middel' } }] },
		findings: ['error CFG_ENUM $.series[0].label.position'],
		runtime: 'accepted',
		why: 'Type contract: closed position list; the runtime renders it without an error or warning.'
	},
	{
		name: 'animation string',
		config: { animation: 'yes' },
		findings: ['error CFG_TYPE $.animation'],
		runtime: 'accepted',
		why: 'Type contract: declared `boolean`; the runtime renders it without an error or warning.'
	},
	{
		name: 'dark mode value',
		config: { darkMode: 'maybe' },
		findings: ['error CFG_ENUM $.darkMode'],
		runtime: 'accepted',
		why: "Type contract: declared `boolean | 'auto'`; the runtime renders it without an error or warning."
	},
	{
		name: 'boundary gap word',
		config: { xAxis: { type: 'value', boundaryGap: 'wide' }, yAxis: { type: 'value' } },
		findings: ['error CFG_TYPE $.xAxis.boundaryGap'],
		runtime: 'accepted',
		why: 'Type contract: declared `[gap, gap] | boolean`; parseBoundaryGapOptionItem turns the word into 0 (`parsePercent(...) || 0`).'
	},
	{
		name: 'extension series',
		config: { series: [{ type: 'wordCloud', data: [] }] },
		findings: ['warning CFG_UNKNOWN_VARIANT $.series[0].type'],
		runtime: 'rejected',
		why: 'Unresolved: echarts-wordcloud registers this series; the harness does not install it.'
	},
	{
		name: 'extension component',
		config: { bmap: { center: [120, 30] } },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'undeclared sankey layout',
		config: { series: { type: 'sankey', layout: 'none', data: [{ name: 'a' }], links: [] } },
		findings: ['warning CFG_UNKNOWN_KEY $.series.layout'],
		runtime: 'accepted',
		why: 'Unresolved: not declared in 6.1.0 (an older example option); the runtime ignores it.'
	},
	{
		name: 'misspelt series key',
		config: { ...axes, series: [{ type: 'line', data: [1], smoth: true }] },
		findings: ['warning CFG_UNKNOWN_KEY $.series[0].smoth'],
		runtime: 'accepted',
		why: 'Unresolved: the runtime ignores unknown keys; the warning carries a suggestion.'
	},
	{
		name: 'dataZoom default subtype',
		config: { ...axes, dataZoom: [{ start: 0, end: 50 }], series: [{ type: 'line', data: [1] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'axis default subtype',
		config: { xAxis: { data: ['a'] }, yAxis: {}, series: [{ type: 'bar', data: [1] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'dataZoom without type is a slider (registerSubTypeDefaulter)',
		config: { ...axes, dataZoom: [{ start: 'x' }], series: [{ type: 'line', data: [1] }] },
		findings: ['error CFG_TYPE $.dataZoom[0].start'],
		runtime: 'accepted',
		why: 'Type contract: declared `number`; the runtime renders it without an error or warning.'
	},
	{
		name: 'inside dataZoom options',
		config: { ...axes, dataZoom: [{ type: 'inside', zoomOnMouseWheel: 'yes' }], series: [{ type: 'line', data: [1] }] },
		findings: ['error CFG_ENUM $.dataZoom[0].zoomOnMouseWheel'],
		runtime: 'accepted',
		why: "Type contract: declared `boolean | 'shift' | 'ctrl' | 'alt'`; the runtime renders it without an error or warning."
	},
	{
		name: 'inside dataZoom has no show option',
		config: { ...axes, dataZoom: [{ type: 'inside', show: true }], series: [{ type: 'line', data: [1] }] },
		findings: ['warning CFG_UNKNOWN_KEY $.dataZoom[0].show'],
		runtime: 'accepted',
		why: 'Unresolved: only the slider declares `show`; the inside subtype ignores it (official line-function example).'
	},
	{
		name: 'dataZoom subtype outside the declarations',
		config: { ...axes, dataZoom: { type: 'select' }, series: [{ type: 'line', data: [1] }] },
		findings: ['warning CFG_UNKNOWN_VARIANT $.dataZoom.type'],
		runtime: 'accepted',
		why: 'Unresolved: subtypes are a registry; `dataZoom.select` is registered by the full bundle (toolbox) but not declared.'
	},
	{
		name: 'scroll legend options',
		config: {
			legend: { type: 'scroll', pageButtonPosition: 1 },
			series: [{ type: 'pie', data: [{ name: 'a', value: 1 }] }]
		},
		findings: ['error CFG_TYPE $.legend.pageButtonPosition'],
		runtime: 'accepted',
		why: "Type contract: declared `'start' | 'end'`; the runtime renders it without an error or warning."
	},
	{
		name: 'axis with data is a category axis (getAxisType)',
		config: { xAxis: { data: ['a'], boundaryGap: 'x' }, yAxis: {}, series: [{ type: 'bar', data: [1] }] },
		findings: ['error CFG_TYPE $.xAxis.boundaryGap'],
		runtime: 'accepted',
		why: 'Type contract: a category axis declares `boolean`; the runtime renders it without an error or warning.'
	},
	{
		name: 'axis without data is a value axis (getAxisType)',
		config: { xAxis: { min: 'dataMin' }, yAxis: { type: 'value' }, series: [{ type: 'scatter', data: [[1, 2]] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'undefined data cells and dimensions (official calendar-lunar, custom-calendar-icon)',
		config: {
			...axes,
			series: [{ type: 'scatter', dimensions: [undefined, { type: 'ordinal' }], data: [['a', 1, 'x', undefined]] }]
		},
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'visualMap default subtype',
		config: { visualMap: { min: 0, max: 10, calculable: 'yes' } },
		findings: ['error CFG_TYPE $.visualMap.calculable'],
		runtime: 'accepted',
		why: 'Type contract: the continuous subtype (the runtime default) declares `calculable` as `boolean`; the runtime renders it without an error or warning.'
	},
	{
		name: 'visualMap piecewise from split number',
		config: { visualMap: { min: 0, max: 10, splitNumber: 5, showLabel: true, itemGap: 'wide' } },
		findings: ['error CFG_TYPE $.visualMap.itemGap'],
		runtime: 'accepted',
		why: 'Type contract: `splitNumber > 0` selects the piecewise subtype, which declares `itemGap` as `number`; the runtime renders it without an error or warning.'
	},
	{
		name: 'visualMap pieces',
		config: { visualMap: [{ pieces: [{ min: 0, max: 5 }, { min: 5 }], showLabel: true }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'visualMap split number as text',
		config: { visualMap: { min: 0, max: 10, splitNumber: '5' } },
		findings: ['info CFG_AMBIGUOUS $.visualMap'],
		runtime: 'accepted'
	},
	{
		name: 'series without type',
		config: { series: [{ data: [1] }] },
		findings: ['info CFG_AMBIGUOUS $.series[0]'],
		runtime: 'rejected',
		why: 'False negative (CG-02-04): a fresh option needs `type`, but a setOption merge update or a timeline `options` entry legitimately omits it; telling the two apart is context.'
	},
	{
		name: 'heatmap without visualMap',
		config: {
			xAxis: { type: 'category', data: ['a'] },
			yAxis: { type: 'category', data: ['b'] },
			series: [{ type: 'heatmap', data: [[0, 0, 1]] }]
		},
		findings: ['error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'cartesian series without axes',
		config: { series: [{ type: 'bar', data: [1] }] },
		findings: ['error CFG_REQUIRES $.series[0]', 'error CFG_REQUIRES $.series[0]'],
		runtime: 'rejected'
	}
];
