/**
 * Highcharts 13.x options both the curated subset and the generated schema must accept. They follow
 * the 13.1.1 declarations; runtime verification on Highcharts is still open (CG-01-08).
 */
export const KNOWN_VALID = {
	'line with union-typed fields': {
		chart: { type: 'line', height: '50%', width: null },
		xAxis: [{ categories: ['a', 'b'] }, { opposite: true }],
		yAxis: { min: null, max: '2026-01-01', title: { text: undefined } },
		series: [{ type: 'line', data: [1, 2], color: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [] } }]
	},
	'column with credits off': {
		chart: { type: 'column' },
		title: { text: 'Sales' },
		xAxis: { categories: ['Q1', 'Q2'] },
		series: [{ name: 'Revenue', data: [3, 4] }],
		credits: { enabled: false }
	},
	// `null` is the documented way to hide a title (TitleOptions.text: string | null), K12.
	'titles hidden with null': {
		title: { text: null },
		subtitle: { text: null },
		series: [{ type: 'column', data: [1, 2] }]
	}
};
