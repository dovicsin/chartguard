/**
 * Like RUNTIME_CONTRACT, with the registry context of the live runtime: each case renders on a page
 * that loads only `modules`, and tools/conformance validates it with the full local schema and
 * `registriesOf` the series types that page's Highcharts had (CG-04-05), so the names the validator
 * is given are exactly the ones the runtime registered.
 */
const SANKEY = { keys: ['from', 'to', 'weight'], data: [['a', 'b', 1]] };

export const MODULE_CONTRACT = [
	{
		name: 'module series without its module',
		config: { series: [{ type: 'sankey', ...SANKEY }] },
		findings: ['error CFG_UNREGISTERED $.series[0].type'],
		runtime: 'rejected'
	},
	{
		name: 'module series with its module',
		modules: ['sankey'],
		config: { series: [{ type: 'sankey', ...SANKEY }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'module chart type without its module, taken by an untyped series',
		config: { chart: { type: 'sankey' }, series: [SANKEY] },
		findings: ['error CFG_UNREGISTERED $.series[0]'],
		runtime: 'rejected'
	},
	{
		name: 'one module loaded, a series of another missing',
		modules: ['sankey'],
		config: { series: [{ type: 'dependencywheel', ...SANKEY }] },
		findings: ['error CFG_UNREGISTERED $.series[0].type'],
		runtime: 'rejected'
	},
	{
		name: 'both modules loaded',
		modules: ['sankey', 'dependency-wheel'],
		config: { series: [{ type: 'dependencywheel', ...SANKEY }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'built-in series type',
		config: { series: [{ type: 'column', data: [1, 2] }] },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'no type: the default line series',
		config: { series: [{ data: [1, 2] }] },
		findings: [],
		runtime: 'accepted'
	}
];
