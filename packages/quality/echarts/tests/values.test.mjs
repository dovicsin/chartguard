import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze, normalize } from '../dist/index.js';

const values = (option) => {
	const fact = normalize(option).series.items[0].values;
	if (!fact.known) return `? ${fact.reason} ${fact.path}`;
	const { count, min, max } = fact.value;
	return `${String(count)} ${String(min?.value)}@${String(min?.path)} ${String(max?.value)}@${String(max?.path)}`;
};

test('numbers, `{ value }` and the empty value `-`', () => {
	assert.equal(
		values({ series: [{ type: 'bar', data: [3, '-', -1, { value: 7 }, { value: '-' }, null] }] }),
		'3 -1@$.series[0].data[2] 7@$.series[0].data[3].value'
	);
	assert.equal(
		values({ series: { type: 'pie', data: [{ name: 'a', value: 2 }] } }),
		'1 2@$.series.data[0].value 2@$.series.data[0].value'
	);
});

test('arrays and data routed from a dataset are not read yet', () => {
	assert.equal(values({ series: [{ type: 'line', data: [['a', 1]] }] }), '? unmodelled $.series[0].data[0]');
	assert.equal(values({ dataset: { source: [[1]] }, series: [{ type: 'bar' }] }), '? unmodelled $.series[0].data');
	assert.equal(values({ series: [{ type: 'bar', encode: { y: 1 }, data: [1] }] }), '? unmodelled $.series[0].data');
	assert.equal(
		values({ series: [{ type: 'bar', data: [{ value: () => 1 }] }] }),
		'? unmodelled $.series[0].data[0].value'
	);
});

test('a negative value in a pie is reported where it is', () => {
	const codes = (option) => analyze(option).diagnostics.map((d) => `${d.code} ${d.path}`);
	assert.deepEqual(
		codes({
			series: [
				{
					type: 'pie',
					data: [
						{ name: 'a', value: 3 },
						{ name: 'b', value: -1 }
					]
				}
			]
		}),
		['VIS_PIE_NEGATIVE $.series[0].data[1].value']
	);
	assert.deepEqual(codes({ series: [{ type: 'pie', data: [3, 1] }] }), []);
});
