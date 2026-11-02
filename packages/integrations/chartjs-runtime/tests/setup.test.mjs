import assert from 'node:assert/strict';
import test from 'node:test';

import { Chart } from 'chart.js';

import { createChartjs } from '../../../../tools/conformance/lib/chartjs.mjs';
import { checkPackagePointers } from '../../../quality/core/tests/pointers.mjs';
import { guard } from '../dist/index.js';

const bar = (options = {}) => ({
	type: 'bar',
	data: { labels: ['a'], datasets: [{ label: 'a', data: [1] }] },
	options
});
const codes = (result) => result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
/** The guard's plugin hooks run on a chart as Chart.js hands it to a plugin. */
const created = (config, options, chart = { constructor: Chart, config: {} }) => {
	const results = [];
	guard(config, { onResult: (result) => results.push(result), ...options })
		.plugins.at(-1)
		.beforeInit(chart);
	return results;
};

test('a plugins accessor is never run nor replaced: guard refuses the config, outside Chart.js (A49)', () => {
	let reads = 0;
	const config = Object.defineProperty(bar(), 'plugins', { enumerable: true, get: () => ((reads += 1), []) });
	assert.throws(() => guard(config), { name: 'TypeError', message: /config\.plugins is an accessor/ });
	assert.throws(() => guard({ ...bar(), plugins: { id: 'own' } }), { name: 'TypeError', message: /not an array/ });
	assert.equal(reads, 0);
	assert.deepEqual(
		guard({ ...bar(), plugins: null }).plugins.map(({ id }) => id),
		['chartguard']
	);
});

test('an inline plugin behind an accessor is kept, never run, and makes the plugin registry incomplete (A49)', () => {
	let reads = 0;
	const plugins = Object.defineProperty([], '0', { enumerable: true, get: () => ((reads += 1), { id: 'labels' }) });
	const config = { ...bar({ plugins: { labels: { size: 1 } } }), plugins };
	const guarded = guard(config);
	assert.equal(reads, 0);
	assert.equal(guarded.plugins.length, 2);
	assert.equal(typeof Object.getOwnPropertyDescriptor(guarded.plugins, '0').get, 'function');
	const [result] = created(config);
	assert.equal(reads, 0);
	// Not a certain CFG_INEFFECTIVE: the unread plugin may be `labels`.
	assert.deepEqual(
		result.diagnostics.filter((d) => d.code === 'CFG_INEFFECTIVE' && d.confidence === 'certain'),
		[]
	);
});

test('options.plugins false (or chartguard false) runs no guard: it is warned at guard(), and refused with block', (t) => {
	const warned = t.mock.method(globalThis.console, 'warn', () => undefined);
	for (const plugins of [false, { chartguard: false }]) {
		const results = [];
		const chart = createChartjs(guard(bar({ plugins }), { onResult: (result) => results.push(result) }));
		chart.destroy();
		assert.deepEqual(results, [], 'Chart.js runs no hook of the guard');
		assert.throws(() => guard(bar({ plugins }), { block: true }), { name: 'TypeError', message: /cannot block/ });
	}
	assert.equal(warned.mock.callCount(), 2);
	assert.match(String(warned.mock.calls[0].arguments[0]), /options\.plugins is false/);
	assert.match(String(warned.mock.calls[1].arguments[0]), /options\.plugins\.chartguard is false/);
	// Behind a getter it is not read: nothing is claimed (README, Known limits).
	const hidden = Object.defineProperty(bar(), 'options', { enumerable: true, get: () => ({ plugins: false }) });
	guard(hidden);
	assert.equal(warned.mock.callCount(), 2);
});

test('a subclass of Chart is checked against the Chart.js version it inherits (A50)', () => {
	class OtherChart {
		static version = '4.4.0';
	}
	class MyChart extends OtherChart {}
	const [result] = created(bar({ responsive: 'yes' }), {}, { constructor: MyChart, config: {} });
	assert.deepEqual(codes(result), ['warning CFG_VERSION_MISMATCH $', 'warning CFG_TYPE $.options.responsive']);
	// An accessor on the constructor is not run.
	let reads = 0;
	class Hidden {
		static get version() {
			reads += 1;
			return '4.4.0';
		}
	}
	created(bar(), {}, { constructor: Hidden, config: {} });
	assert.equal(reads, 0);
});

test('a throwing onResult never throws inside Chart.js: the error is rethrown outside it', (t) => {
	const deferred = [];
	t.mock.method(globalThis, 'queueMicrotask', (callback) => deferred.push(callback));
	const before = Object.keys(Chart.instances).length;
	const failure = new Error('reporter failed');
	const config = guard(bar(), {
		onResult: () => {
			throw failure;
		}
	});
	const chart = createChartjs(config);
	chart.update();
	chart.destroy();
	assert.equal(Object.keys(Chart.instances).length, before);
	assert.equal(deferred.length, 2);
	assert.throws(deferred[0], (error) => error === failure);
});

test('every runtime pointer the guard rests on is a literal that still holds in the pinned chart.js (E37)', () =>
	assert.equal(checkPackagePointers(import.meta.url), 6));
