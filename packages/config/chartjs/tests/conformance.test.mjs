import assert from 'node:assert/strict';
import test from 'node:test';

import { manifest, validate } from '../dist/index.js';

/** Configurations shaped after the official Chart.js 4.x documentation samples. */
const KNOWN_VALID = {
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

for (const [name, config] of Object.entries(KNOWN_VALID))
	test(`known-valid: ${name}`, () => {
		const result = validate(config);
		assert.equal(result.valid, true);
		assert.deepEqual(
			result.diagnostics.filter((d) => d.severity !== 'info'),
			[]
		);
	});

const errorsOf = (config) =>
	validate(config)
		.diagnostics.filter((d) => d.severity === 'error')
		.map((d) => `${d.code} ${d.path}`);

test('known-invalid: wrong primitive types are confirmed errors', () => {
	assert.deepEqual(errorsOf({ type: 'bar', data: { datasets: [] }, options: { responsive: 'yes' } }), [
		'CFG_TYPE $.options.responsive'
	]);
	assert.deepEqual(errorsOf({ type: 'bar', data: { datasets: [{ data: [1], backgroundColor: true }] } }), [
		'CFG_TYPE $.data.datasets[0].backgroundColor'
	]);
	assert.deepEqual(
		errorsOf({ type: 'bar', data: { datasets: [] }, options: { scales: { y: { type: 'linear', min: '50' } } } }),
		['CFG_TYPE $.options.scales.y.min']
	);
	assert.deepEqual(errorsOf({ type: 'bar' }), ['CFG_REQUIRED $.data']);
});

test('unknown chart types and keys are warnings with suggestions, never errors', () => {
	const result = validate({ type: 'barr', data: { datasets: [] } });
	assert.equal(result.valid, true);
	assert.deepEqual(
		result.diagnostics.map((d) => [d.code, d.suggestion]),
		[['CFG_UNKNOWN_VARIANT', 'Did you mean "bar"?']]
	);
	const typo = validate({ type: 'bar', data: { datasets: [] }, options: { responsiv: true } });
	assert.deepEqual(
		typo.diagnostics.map((d) => [d.code, d.severity, d.suggestion]),
		[['CFG_UNKNOWN_KEY', 'warning', 'Did you mean "responsive"?']]
	);
});

test('a scale without a type is reported as inconclusive, not guessed', () => {
	const result = validate({ type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: '50' } } } });
	assert.equal(result.valid, true);
	assert.deepEqual(
		result.diagnostics.map((d) => `${d.code} ${d.severity} ${d.path}`),
		['CFG_AMBIGUOUS info $.options.scales.y']
	);
});

test('the manifest is generated for the exact pinned version', () => {
	assert.equal(manifest.version, '4.5.1');
	assert.equal(manifest.coverage, 'partial');
	assert.equal(manifest.source, 'chart.js@4.5.1');
});
