import assert from 'node:assert/strict';
import test from 'node:test';

import { BasicPlatform } from 'chart.js';

import { validate } from '../../../packages/config/chartjs/dist/index.js';
import { createChartjs } from '../lib/chartjs.mjs';

/**
 * A platform that counts the listeners Chart.js binds, and says the canvas is attached, so a
 * responsive chart takes its attached path (`bindResponsiveEvents`) as in a page.
 */
class CountingPlatform extends BasicPlatform {
	bound = [];
	addEventListener(_chart, type) {
		this.bound.push(type);
	}
	isAttached() {
		return true;
	}
}

/** The listener types bound at creation, and at each of three updates after it. */
function bindings(responsive) {
	let platform;
	const Platform = class extends CountingPlatform {
		constructor() {
			super();
			platform = this;
		}
	};
	const chart = createChartjs({
		type: 'bar',
		data: { labels: ['a'], datasets: [{ data: [1] }] },
		options: { responsive, animation: false },
		platform: Platform
	});
	try {
		const created = [...platform.bound];
		const updates = [1, 2, 3].map(() => {
			platform.bound = [];
			chart.update();
			return [...platform.bound];
		});
		return { created, updates };
	} finally {
		chart.destroy();
	}
}

/** What the schema says the runtime does with a mismatched `responsive` (A73). */
const effectOf = (responsive) =>
	validate({ type: 'bar', data: { datasets: [] }, options: { responsive } }).diagnostics.find(
		({ path }) => path === '$.options.responsive'
	)?.message;

test('a boolean responsive binds its listeners once: updates bind nothing again', () => {
	for (const responsive of [true, false]) {
		const { updates } = bindings(responsive);
		assert.deepEqual(updates, [[], [], []], String(responsive));
		assert.equal(effectOf(responsive), undefined);
	}
});

test('any other responsive makes every update bind all listeners again, as the CFG_TYPE finding says (A73)', () => {
	for (const responsive of ['yes', 1, 0, '', null]) {
		const { created, updates } = bindings(responsive);
		const truthy = Boolean(responsive);
		for (const bound of updates) {
			assert.ok(bound.length > 0, `${String(responsive)}: rebinds at every update`);
			// A truthy value binds the resize listeners again (the attached path runs the resize step).
			assert.equal(bound.includes('resize'), truthy, String(responsive));
		}
		assert.equal(created.includes('resize'), truthy, String(responsive));
		const message = effectOf(responsive);
		assert.match(message ?? '', /^Expected boolean \| function, got \w+\. Chart\.js compares responsive with !==/);
		assert.match(message ?? '', /every update unbind and bind all its event listeners again/);
		assert.match(message ?? '', /a truthy one also runs its resize step each time/);
	}
});
