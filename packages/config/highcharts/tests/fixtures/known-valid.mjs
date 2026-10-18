/**
 * Highcharts 13.x options the curated subset must accept. Not runtime-verified: the Highcharts
 * runtime is not installed (CG-01-05), so these follow the 13.1.1 TypeScript declarations.
 */
export const KNOWN_VALID = {
	'line with union-typed fields': {
		chart: { type: 'line', height: '50%', width: null },
		xAxis: [{ categories: ['a', 'b'] }, { opposite: true }],
		yAxis: { min: null, max: '2026-01-01', title: { text: null } },
		series: [{ type: 'line', data: [1, 2], color: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [] } }]
	},
	'column with credits off': {
		chart: { type: 'column' },
		title: { text: 'Sales' },
		xAxis: { categories: ['Q1', 'Q2'] },
		series: [{ name: 'Revenue', data: [3, 4] }],
		credits: { enabled: false }
	}
};
