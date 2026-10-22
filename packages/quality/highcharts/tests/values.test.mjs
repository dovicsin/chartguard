import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const values = (config) => {
	const fact = normalize(config).series.items[0].values;
	if (!fact.known) return `? ${fact.reason} ${fact.path}`;
	const { count, min, max } = fact.value;
	return `${String(count)} ${String(min?.value)}@${String(min?.path)} ${String(max?.value)}@${String(max?.path)}`;
};

test('y values: numbers, [x, y] or [name, y], and { y }; null is a gap', () => {
	assert.equal(
		values({ series: [{ data: [3, null, [1, -1], { y: 7 }, ['b', null]] }] }),
		'3 -1@$.series[0].data[2][1] 7@$.series[0].data[3].y'
	);
});

test('longer arrays, objects without y and keys are not read yet', () => {
	assert.equal(values({ series: [{ type: 'arearange', data: [[1, 2, 3]] }] }), '? unmodelled $.series[0].data[0]');
	assert.equal(values({ series: [{ type: 'heatmap', data: [{ value: 1 }] }] }), '? unmodelled $.series[0].data[0].y');
	assert.equal(values({ series: [{ keys: ['y', 'x'], data: [[1, 2]] }] }), '? unmodelled $.series[0].data');
	assert.equal(
		values({ plotOptions: { series: { keys: ['name', 'y'] } }, series: [{ data: [['a', 1]] }] }),
		'? unmodelled $.series[0].data'
	);
});

test('a negative value in a pie is reported where it is', () => {
	// Only the rule under test: the label rules fire on these bare configs too.
	const codes = (config) =>
		analyze(config)
			.diagnostics.filter((d) => d.code === 'VIS_PIE_NEGATIVE')
			.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(
		codes({
			series: [
				{
					type: 'pie',
					data: [
						['a', 3],
						['b', -1]
					]
				}
			]
		}),
		['VIS_PIE_NEGATIVE $.series[0].data[1][1]']
	);
	assert.deepEqual(codes({ series: [{ type: 'pie', data: [{ y: 3 }, { y: 1 }] }] }), []);
});
