import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';

/**
 * Work grows with the input, never with its square (CG-07-02): the number of series is the caller's,
 * so a check that reads every series once per series is a denial of service on a large config.
 * Counted, never timed: each item and its list is a Proxy that counts the reads of it (own-property reads on a
 * Proxy run its traps), and doubling the series must not much more than double the reads.
 */
const COUNTED = ['get', 'getOwnPropertyDescriptor', 'ownKeys', 'has', 'getPrototypeOf'];

function countingItems(count, make) {
	const reads = { count: 0 };
	const handler = Object.fromEntries(
		COUNTED.map((trap) => [
			trap,
			(...args) => {
				reads.count += 1;
				return Reflect[trap](...args);
			}
		])
	);
	// The list counts too: rebuilding it for each item reads it once per item.
	const items = Array.from({ length: count }, (_, index) => new Proxy(make(index), handler));
	return { reads, items: new Proxy(items, handler) };
}

const LIBRARIES = {
	chartjs: {
		checks: { validate: validateChartjs, analyze: analyzeChartjs },
		config: (items) => ({ type: 'line', data: { labels: ['a', 'b'], datasets: items } }),
		series: (index) => ({ label: `s${String(index)}`, data: [1, 2] }),
		axes: (items) => ({
			type: 'line',
			data: { labels: ['a', 'b'], datasets: [{ data: [1, 2] }] },
			options: { scales: Object.fromEntries(items.map((item, index) => [`y${String(index)}`, item])) }
		}),
		axis: () => ({ type: 'linear', axis: 'y' })
	},
	echarts: {
		checks: { validate: validateEcharts, analyze: analyzeEcharts },
		config: (items) => ({
			xAxis: { type: 'category', data: ['a', 'b'] },
			yAxis: { type: 'value' },
			legend: { data: items.map((_, index) => `s${String(index)}`) },
			series: items
		}),
		series: (index) => ({ type: 'line', name: `s${String(index)}`, data: [1, 2] }),
		axes: (items) => ({
			xAxis: { type: 'category', data: ['a', 'b'] },
			yAxis: items,
			series: [{ type: 'line', data: [1, 2] }]
		}),
		axis: () => ({ type: 'value' })
	},
	highcharts: {
		checks: { validate: validateHighcharts, analyze: analyzeHighcharts },
		config: (items) => ({ xAxis: { categories: ['a', 'b'] }, series: items }),
		series: (index) => ({ type: 'line', name: `s${String(index)}`, data: [1, 2] }),
		axes: (items) => ({ xAxis: { categories: ['a', 'b'] }, yAxis: items, series: [{ type: 'line', data: [1, 2] }] }),
		axis: () => ({ min: 0 })
	}
};

/** Items a check does not read at all: the Highcharts starter schema has no `yAxis` (any value passes). */
const UNREAD = new Set(['highcharts validate axes']);

/** The reads of the items one run of `check` makes for `count` items made by `make` and placed by `place`. */
function readsFor(place, make, check, count) {
	const { reads, items } = countingItems(count, make);
	check(place(items));
	return reads.count;
}

for (const [library, setup] of Object.entries(LIBRARIES))
	for (const [name, check] of Object.entries(setup.checks))
		for (const [what, place, make] of [
			['series', setup.config, setup.series],
			['axes', setup.axes, setup.axis]
		])
			test(`${library} ${name}: the reads of the ${what} grow linearly with their number`, () => {
				const [small, large] = [200, 400].map((count) => readsFor(place, make, check, count));
				if (UNREAD.has(`${library} ${name} ${what}`)) {
					assert.deepEqual([small, large], [0, 0], 'read now: remove it from UNREAD');
					return;
				}
				assert.ok(small > 0, `the ${what} are read`);
				assert.ok(large <= small * 2.5, `${String(small)} reads for 200 ${what}, ${String(large)} for 400`);
			});
