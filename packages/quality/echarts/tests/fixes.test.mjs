import assert from 'node:assert/strict';
import test from 'node:test';

import { analyze } from '../dist/index.js';

/** ECharts fixes (CG-05-06): each remedy, its preconditions, and where none is offered. */
const fixes = (option) =>
	analyze(option).diagnostics.map(
		({ code, fix }) =>
			`${code} ${fix === undefined ? '-' : `${fix.path} ${JSON.stringify(fix.from)}→${JSON.stringify(fix.value)}`}`
	);
const chart = (yAxis = {}, series = [{ type: 'bar', data: [60, 70] }], extra = {}) => ({
	title: { text: 'T' },
	aria: { enabled: true },
	xAxis: { type: 'category', data: ['a', 'b'] },
	yAxis: { name: 'U', ...yAxis },
	series,
	...extra
});

test('bar baseline: a bound, dataMin or startValue to 0, scale back to false', () => {
	assert.deepEqual(fixes(chart({ min: 50 })), ['VIS_BAR_BASELINE $.yAxis.min 50→0']);
	assert.deepEqual(fixes(chart({ min: 'dataMin' })), ['VIS_BAR_BASELINE $.yAxis.min "dataMin"→0']);
	// With a negative bar the data minimum is below zero: no finding, and no fix that would hide that bar (H8).
	assert.deepEqual(fixes(chart({ min: 'dataMin' }, [{ type: 'bar', data: [-5, 3, 10] }])), []);
	assert.deepEqual(fixes(chart({ scale: true })), ['VIS_BAR_BASELINE $.yAxis.scale true→false']);
	assert.deepEqual(fixes(chart({ startValue: 20 })), ['VIS_BAR_BASELINE $.yAxis.startValue 20→0']);
});

test('log to value, inverse off, aria on (or its label), animation to one second', () => {
	assert.deepEqual(fixes(chart({ type: 'log' })), ['VIS_BAR_LOG_SCALE $.yAxis.type "log"→"value"']);
	assert.deepEqual(fixes(chart({ inverse: true }, [{ type: 'line', data: [1, 2] }])), [
		'VIS_REVERSED_VALUE_AXIS $.yAxis.inverse true→false'
	]);
	const undescribed = Object.fromEntries(Object.entries(chart()).filter(([key]) => key !== 'aria'));
	assert.deepEqual(fixes(undescribed), ['VIS_DATA_NOT_DESCRIBED $.aria.enabled undefined→true']);
	assert.deepEqual(fixes({ ...undescribed, aria: { enabled: false } }), [
		'VIS_DATA_NOT_DESCRIBED $.aria.enabled false→true'
	]);
	assert.deepEqual(fixes({ ...undescribed, aria: { enabled: true, label: { enabled: false } } }), [
		'VIS_DATA_NOT_DESCRIBED $.aria.label.enabled false→true'
	]);
	assert.deepEqual(fixes(chart({}, undefined, { animationDuration: 6000 })), [
		'VIS_LONG_MOTION $.animationDuration 6000→1000'
	]);
});

test('motion that never stops: a ripple only on hover; a lines effect once, only when one run is known to be short', () => {
	assert.deepEqual(fixes(chart({}, [{ type: 'effectScatter', data: [1, 2] }])), [
		'VIS_LONG_MOTION $.series[0].showEffectOn undefined→"emphasis"'
	]);
	assert.deepEqual(fixes(chart({}, [{ type: 'effectScatter', showEffectOn: 'render', data: [1, 2] }])), [
		'VIS_LONG_MOTION $.series[0].showEffectOn "render"→"emphasis"'
	]);
	const lines = (effect) => ({
		title: { text: 'T' },
		aria: { enabled: true },
		xAxis: { type: 'value', name: 'X' },
		yAxis: { type: 'value', name: 'Y' },
		series: [
			{
				type: 'lines',
				coordinateSystem: 'cartesian2d',
				effect: { show: true, ...effect },
				data: [
					{
						coords: [
							[0, 0],
							[1, 1]
						]
					}
				]
			}
		]
	});
	assert.deepEqual(fixes(lines({})), ['VIS_LONG_MOTION $.series[0].effect.loop undefined→false']);
	assert.deepEqual(fixes(lines({ period: 5 })), ['VIS_LONG_MOTION $.series[0].effect.loop undefined→false']);
	// One run longer than five seconds, or as long as the path at a constant speed: no fix.
	assert.deepEqual(fixes(lines({ period: 6 })), ['VIS_LONG_MOTION -']);
	assert.deepEqual(fixes(lines({ constantSpeed: 20 })), ['VIS_LONG_MOTION -']);
});

test('no fix where the finding needs the author', () => {
	assert.deepEqual(fixes({ ...chart(), title: { text: '' } }), ['VIS_EMPTY_TITLE -']);
	const twoAxes = {
		...chart({}, [
			{ type: 'bar', data: [1, 2] },
			{ type: 'line', data: [3, 4], yAxisIndex: 1 }
		]),
		yAxis: [{ name: 'U' }, { name: 'V' }]
	};
	assert.deepEqual(fixes(twoAxes), ['VIS_DUAL_AXIS -']);
});
