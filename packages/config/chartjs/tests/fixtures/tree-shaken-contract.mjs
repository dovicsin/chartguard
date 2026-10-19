/**
 * Like RUNTIME_CONTRACT, on a tree-shaken runtime: only `modules` are registered
 * (`Chart.register(...)` in an application that does not import `chart.js/auto`). tools/conformance
 * validates each case with the registry context read back from that runtime, so the names the
 * validator is given are exactly the ones the runtime registered.
 */
const line = (extra = {}) => ({ type: 'line', data: { labels: ['a', 'b'], datasets: [{ data: [1, 2], ...extra }] } });
const LINE_ONLY = ['LineController', 'LineElement', 'PointElement', 'CategoryScale', 'LinearScale'];

export const TREE_SHAKEN_CONTRACT = [
	{
		name: 'registered controller',
		modules: LINE_ONLY,
		config: line(),
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'dataset controller not registered',
		modules: LINE_ONLY,
		config: line({ type: 'bar' }),
		findings: ['error CFG_UNREGISTERED $.data.datasets[0].type'],
		runtime: 'rejected'
	},
	{
		name: 'chart type not registered, inherited by its dataset',
		modules: LINE_ONLY,
		config: { type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } },
		findings: ['error CFG_UNREGISTERED $.data.datasets[0]'],
		runtime: 'rejected'
	},
	{
		name: 'chart type not registered, no datasets',
		modules: LINE_ONLY,
		config: { type: 'bar', data: { datasets: [] } },
		findings: [],
		runtime: 'accepted'
	},
	{
		name: 'scale not registered',
		modules: LINE_ONLY,
		config: { ...line(), options: { scales: { y: { type: 'logarithmic' } } } },
		findings: ['error CFG_UNREGISTERED $.options.scales.y.type'],
		runtime: 'rejected'
	}
];
