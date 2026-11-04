import { cjBars, ecBars, hcBars, LABELS } from './charts.mjs';

/** A Chart.js bar chart whose dataset has no `label`, with the titles a real chart has. */
const cjUnlabelled = (options = {}) => {
	const config = cjBars([1, 2], { title: { display: true, text: 'Units' } }, options);
	return { ...config, data: { labels: LABELS, datasets: [{ data: [1, 2] }] } };
};

/**
 * The rules contract's cases about legend entries (CG-05-04 part 9): they name their series
 * themselves, or leave them unnamed on purpose (`legend`).
 */
export const LEGEND_CASES = [
	{
		name: 'an unnamed series in the legend shows the placeholder',
		rule: 'legend-placeholder',
		kind: 'triggers',
		legend: true,
		chartjs: { config: cjUnlabelled(), findings: ['VIS_LEGEND_PLACEHOLDER $.data.datasets[0].label'] },
		highcharts: { config: hcBars([1, 2], {}), findings: ['VIS_LEGEND_PLACEHOLDER $.series[0].name'] }
	},
	{
		name: 'only the unnamed series of two, and a null name, get the placeholder',
		rule: 'legend-placeholder',
		kind: 'triggers',
		legend: true,
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				series: [
					{ name: 'Sales', data: [1, 2] },
					{ name: null, data: [2, 1] }
				]
			},
			findings: ['VIS_LEGEND_PLACEHOLDER $.series[1].name']
		}
	},
	{
		name: 'counterexample: a legend turned off draws no entry',
		rule: 'legend-placeholder',
		kind: 'counterexample',
		legend: true,
		chartjs: { config: cjUnlabelled({ plugins: { legend: { display: false } } }), findings: [] },
		highcharts: { config: { ...hcBars([1, 2], {}), legend: { enabled: false } }, findings: [] }
	},
	{
		name: 'counterexample: an unnamed series is not listed in an echarts legend',
		rule: 'legend-placeholder',
		kind: 'counterexample',
		legend: true,
		echarts: { config: { ...ecBars([1, 2], { name: 'Units' }), legend: {} }, findings: [] }
	},
	{
		name: 'counterexample: a linked series has no entry; a pie lists its labels',
		rule: 'legend-placeholder',
		kind: 'counterexample',
		legend: true,
		chartjs: { config: { type: 'pie', data: { labels: LABELS, datasets: [{ data: [1, 2] }] } }, findings: [] },
		highcharts: {
			config: {
				...hcBars([1, 2], {}),
				series: [
					{ name: 'Sales', data: [1, 2] },
					{ type: 'line', data: [1, 2], linkedTo: ':previous' }
				]
			},
			findings: []
		}
	},
	{
		name: 'unknown: what the legend draws is decided outside the names',
		rule: 'legend-placeholder',
		kind: 'unknown',
		legend: true,
		chartjs: { config: cjUnlabelled({ plugins: { legend: { labels: { filter: () => true } } } }), findings: [] },
		echarts: { config: { ...ecBars([1, 2], { name: 'Units' }), legend: { data: ['series\u00000'] } }, findings: [] },
		highcharts: { config: { ...hcBars([1, 2], {}), lang: { seriesName: 'Reihe {add index 1}' } }, findings: [] }
	}
];
