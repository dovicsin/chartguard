/**
 * Configurations shaped after the official Chart.js 4.x documentation samples. Each one renders
 * on the pinned runtime without errors or warnings (tools/conformance; the time scale uses the
 * harness's stand-in date adapter, as applications install one).
 */
export const KNOWN_VALID = {
	'bar with options': {
		type: 'bar',
		data: { labels: ['Red', 'Blue'], datasets: [{ label: '# of Votes', data: [12, 19], borderWidth: 1 }] },
		options: { scales: { y: { type: 'linear', beginAtZero: true } } }
	},
	'line with tension and fill': {
		type: 'line',
		data: {
			labels: ['Jan', 'Feb'],
			datasets: [{ data: [65, 59], fill: false, borderColor: 'rgb(75, 192, 192)', tension: 0.1 }]
		}
	},
	'doughnut with string cutout': {
		type: 'doughnut',
		data: {
			datasets: [{ data: [300, 50], backgroundColor: ['rgb(255, 99, 132)', 'rgb(54, 162, 235)'], hoverOffset: 4 }]
		},
		options: { cutout: '60%', plugins: { legend: { position: 'top' } } }
	},
	'mixed bar and line': {
		type: 'bar',
		data: {
			datasets: [
				{ type: 'bar', data: [10, 20] },
				{ type: 'line', data: [5, 15], tension: 0.4, pointRadius: 0 }
			]
		}
	},
	'time scale with string bounds': {
		type: 'line',
		data: { datasets: [{ data: [{ x: '2024-01-01', y: 1 }] }] },
		options: { scales: { x: { type: 'time', min: '2024-01-01', time: { unit: 'month' } } } }
	},
	'object data with parsing keys': {
		type: 'bar',
		data: {
			datasets: [{ data: [{ id: 'a', nested: { value: 1 } }], parsing: { xAxisKey: 'id', yAxisKey: 'nested.value' } }]
		}
	},
	'scriptable options': {
		type: 'bar',
		data: { datasets: [{ data: [1], backgroundColor: (context) => (context.raw > 0 ? 'green' : 'red') }] },
		options: { onClick: () => undefined, plugins: { tooltip: { callbacks: { label: (item) => `${item.raw}` } } } }
	},
	'third-party plugin namespace': {
		type: 'bar',
		data: { datasets: [] },
		options: { plugins: { datalabels: { color: '#fff' }, annotation: { annotations: {} } } }
	},
	'radar with radial scale': {
		type: 'radar',
		data: { labels: ['A', 'B', 'C'], datasets: [{ data: [1, 2, 3] }] },
		options: { scales: { r: { min: 0, suggestedMax: 5, angleLines: { display: false } } } }
	},
	'inline plugin object': {
		type: 'pie',
		data: { datasets: [{ data: [1] }] },
		plugins: [{ id: 'custom', beforeDraw: () => undefined, anything: true }]
	}
};
