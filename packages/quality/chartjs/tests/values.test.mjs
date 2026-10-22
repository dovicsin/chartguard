import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

/** The value facts of the first dataset, briefly: `count min@path max@path`, or the unknown reason. */
const values = (config) => {
	const fact = normalize(config).series.items[0].values;
	if (!fact.known) return `? ${fact.reason} ${fact.path}`;
	const { count, min, max } = fact.value;
	return `${String(count)} ${String(min?.value)}@${String(min?.path)} ${String(max?.value)}@${String(max?.path)}`;
};
const dataset = (data, extra = {}, type = 'bar', options = {}) => ({
	type,
	data: { datasets: [{ data, ...extra }] },
	options
});

test('numbers and gaps; objects by the value axis key (y, or x for horizontal datasets), arcs by value', () => {
	assert.equal(values(dataset([3, null, -1, 7])), '3 -1@$.data.datasets[0].data[2] 7@$.data.datasets[0].data[3]');
	assert.equal(
		values(
			dataset([
				{ x: 'a', y: 4 },
				{ x: 'b', y: null }
			])
		),
		'1 4@$.data.datasets[0].data[0].y 4@$.data.datasets[0].data[0].y'
	);
	assert.equal(
		values(dataset([{ x: 2, y: 'a' }], { indexAxis: 'y' })),
		'1 2@$.data.datasets[0].data[0].x 2@$.data.datasets[0].data[0].x'
	);
	assert.equal(
		values(dataset([{ value: -2 }, 3], {}, 'pie')),
		'2 -2@$.data.datasets[0].data[0].value 3@$.data.datasets[0].data[1]'
	);
	assert.equal(values(dataset(undefined)), '0 undefined@undefined undefined@undefined');
});

test('shapes not read yet, custom parsing and getters leave the values unknown', () => {
	assert.equal(values(dataset([[1, 2]])), '? unmodelled $.data.datasets[0].data[0]');
	assert.equal(values(dataset([{ x: 'a', y: 'tall' }])), '? shape $.data.datasets[0].data[0].y');
	assert.equal(
		values(dataset([{ x: 'a', y: 1 }], { parsing: { yAxisKey: 'v' } })),
		'? unmodelled $.data.datasets[0].data'
	);
	assert.equal(values(dataset([1], {}, 'bar', { parsing: false })), '? unmodelled $.data.datasets[0].data');
	assert.equal(values(dataset([1], { parsing: true })), '1 1@$.data.datasets[0].data[0] 1@$.data.datasets[0].data[0]');
	assert.equal(
		values(dataset([Object.defineProperty({ x: 'a' }, 'y', { get: () => 1 })])),
		'? accessor $.data.datasets[0].data[0].y'
	);
	assert.equal(
		values(dataset([{ x: 'a', y: 1 }], { indexAxis: () => 'y' })),
		'? unmodelled $.data.datasets[0].data[0]'
	);
});

test('a negative value in a pie or doughnut is reported where it is', () => {
	// Only the rule under test: the label rules fire on these bare configs too.
	const codes = (config) =>
		analyze(config)
			.diagnostics.filter((d) => d.code === 'VIS_PIE_NEGATIVE')
			.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(codes(dataset([3, -1, 2], {}, 'doughnut')), ['VIS_PIE_NEGATIVE $.data.datasets[0].data[1]']);
	assert.deepEqual(codes(dataset([3, 0, 2], {}, 'pie')), []);
	assert.deepEqual(codes(dataset([3, -1, 2], {}, 'bar')), []);
});
