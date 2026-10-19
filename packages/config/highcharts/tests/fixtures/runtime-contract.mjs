/**
 * Options whose findings against the locally generated schema and whose runtime behaviour on
 * highcharts@13.1.1 are both pinned (tools/conformance renders them in headless Chrome, with the
 * accessibility module and the case's `modules`). Explanations as in the ECharts table:
 * `Type contract:`, `Unresolved:`, `False negative (CG-XX-YY):`.
 */
const line = (extra = {}) => ({ series: [{ type: 'line', data: [1, 2], ...extra }] });

export const RUNTIME_CONTRACT = [
	{
		name: 'line width word',
		config: line({ lineWidth: 'thick' }),
		findings: ['error CFG_TYPE $.series[0].lineWidth'],
		runtime: 'accepted',
		why: 'Type contract: declared `number`; the runtime renders it without an error or warning.'
	},
	{
		name: 'credits enabled string',
		config: { ...line(), credits: { enabled: 'no' } },
		findings: ['error CFG_TYPE $.credits.enabled'],
		runtime: 'accepted',
		why: 'Type contract: declared `boolean`; the runtime renders it without an error or warning.'
	},
	{
		name: 'zooming type value',
		config: { ...line(), chart: { zooming: { type: 'xyz' } } },
		findings: ['error CFG_ENUM $.chart.zooming.type'],
		runtime: 'accepted',
		why: "Type contract: declared `'x' | 'xy' | 'y'`; the runtime renders it without an error or warning."
	},
	{
		name: 'axis title disabled with null',
		config: { ...line(), yAxis: { title: { text: null } } },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'series type typo',
		config: { series: [{ type: 'linee', data: [1] }] },
		findings: ['warning CFG_UNKNOWN_VARIANT $.series[0].type'],
		runtime: 'rejected',
		why: 'Unresolved: a plugin may register the type; without one the runtime throws error #17.'
	},
	{
		name: 'module series without its module',
		config: { series: [{ type: 'sankey', data: [] }] },
		findings: [],
		runtime: 'rejected',
		why: 'False negative (CG-03-06): the schema describes every module; which ones are loaded is a registry context (`highcharts.series`), detected from source by CG-03-06.'
	},
	{
		name: 'module series with its module',
		modules: ['sankey'],
		config: { series: [{ type: 'sankey', keys: ['from', 'to', 'weight'], data: [['a', 'b', 1]] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'series without type takes the chart type',
		config: { chart: { type: 'column' }, series: [{ data: [1, 2], pointPadding: 0.2 }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'series without type is checked as the chart type',
		config: { chart: { type: 'pie' }, series: [{ data: [1, 2], innerSize: true }] },
		findings: ['error CFG_TYPE $.series[0].innerSize'],
		runtime: 'accepted',
		why: 'Type contract: declared `number | string` on pie series; the runtime renders it without an error or warning.'
	},
	{
		name: 'pie with inner size',
		config: { series: [{ type: 'pie', innerSize: '50%', data: [{ name: 'a', y: 1 }] }] },
		findings: [],
		runtime: 'accepted'
	}
];
