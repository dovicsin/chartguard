/**
 * Like RUNTIME_CONTRACT, on a tree-shaken runtime: `echarts/core` with only `modules` registered
 * (`use([...])`, export names from `echarts/charts` and `echarts/components`). tools/conformance
 * validates each case with the registry context read back from that runtime, so the names the
 * validator is given are exactly the ones the runtime registered.
 */
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };
const LINE_ONLY = ['LineChart', 'GridComponent'];
const lineSeries = [{ type: 'line', data: [1] }];

export const TREE_SHAKEN_CONTRACT = [
	{
		name: 'registered series',
		modules: LINE_ONLY,
		config: { ...axes, series: lineSeries },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'series not imported',
		modules: LINE_ONLY,
		config: { ...axes, series: [{ type: 'bar', data: [1] }] },
		findings: ['error CFG_UNREGISTERED $.series[0].type'],
		runtime: 'rejected'
	},
	{
		name: 'default dataZoom subtype not imported',
		modules: [...LINE_ONLY, 'DataZoomInsideComponent'],
		config: { ...axes, dataZoom: { start: 0 }, series: lineSeries },
		findings: ['error CFG_UNREGISTERED $.dataZoom'],
		runtime: 'rejected'
	},
	{
		name: 'imported dataZoom subtype',
		modules: [...LINE_ONLY, 'DataZoomInsideComponent'],
		config: { ...axes, dataZoom: { type: 'inside', start: 0 }, series: lineSeries },
		findings: [],
		runtime: 'accepted'
	}
];
