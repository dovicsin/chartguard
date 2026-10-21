import assert from 'node:assert/strict';
import test from 'node:test';

// Only echarts/core in this file (its own process): the registry holds what `use` registered.
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';

import { checkOption, registriesOf, setOption } from '../dist/index.js';

echarts.use([SVGRenderer, LineChart, GridComponent]);
const AXES = { xAxis: { type: 'category', data: ['a'] }, yAxis: {} };
const errors = (result) => result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.path}`);

function chartFor(t) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	t.after(() => chart.dispose());
	return chart;
}

test('registriesOf reads the classes a tree-shaken echarts registered; anything else gives no context', () => {
	const { names, complete } = registriesOf(echarts).echarts;
	assert.equal(complete, true);
	assert.ok(names.includes('series.line') && names.includes('grid'));
	assert.ok(!names.includes('series.bar'));
	// A bundled application's namespace exposes its exports through getters (esbuild `__export`).
	const bundled = Object.defineProperty({}, 'ComponentModel', { enumerable: true, get: () => echarts.ComponentModel });
	assert.deepEqual(registriesOf(bundled), registriesOf(echarts));
	assert.deepEqual(registriesOf({}), {});
	assert.deepEqual(
		registriesOf({ ComponentModel: { getAllClassMainTypes: () => 'x', getClassesByMainType: () => [] } }),
		{}
	);
});

test('setOption with guard.echarts checks against what is registered at that call', (t) => {
	const logged = t.mock.method(globalThis.console, 'error', () => undefined);
	const chart = chartFor(t);
	const bar = { ...AXES, series: [{ type: 'bar', data: [1] }] };
	// Without the runtime, no context: nothing is claimed about registration.
	assert.deepEqual(errors(checkOption(chart, bar)), []);
	const blocked = setOption(chart, bar, undefined, { echarts, block: true, onResult: () => undefined });
	assert.deepEqual(errors(blocked), ['CFG_UNREGISTERED $.series[0].type']);
	assert.equal(chart.getOption(), undefined);
	// What echarts does with it: the series is dropped with "used but not imported".
	chart.setOption(bar);
	assert.equal(chart.getOption().series.length, 0);
	assert.ok(logged.mock.calls.some((call) => call.arguments.join(' ').includes('bar is used but not imported')));
	// Registered later: the next call knows it. A registry the caller names wins over the read one.
	const named = { echarts, options: { registries: { echarts: { names: [], complete: false } } } };
	assert.deepEqual(errors(checkOption(chartFor(t), bar, undefined, named)), []);
	echarts.use([BarChart]);
	assert.deepEqual(errors(checkOption(chartFor(t), bar, undefined, { echarts })), []);
});
