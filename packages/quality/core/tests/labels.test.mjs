import assert from 'node:assert/strict';
import test from 'node:test';

import { review } from '../dist/index.js';

/** The label rules (CG-05-04 part 3). */
const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unset') => ({ known: false, path, reason });
const title = (text, shown = none('$.shown')) => ({ text, shown });
const axis = (axisTitle) => ({
	key: 'y',
	path: '$.y',
	scale: none('$.s'),
	min: none('$.m'),
	max: none('$.M'),
	reversed: none('$.r'),
	title: axisTitle
});
const line = {
	path: '$.s',
	type: fact('line', '$.t'),
	kind: fact('line', '$.t'),
	name: none('$.n'),
	valueAxis: fact('y', '$.a'),
	orientation: fact('vertical', '$.o')
};
const chart = (chartTitle, axisTitle) => ({
	library: 't',
	title: chartTitle,
	series: { known: true, path: '$.series', items: [line] },
	axes: [axis(axisTitle)]
});
const codes = (semantics) => review(semantics).diagnostics.map((d) => `${d.code} ${d.path}`);

test('placeholder text: a non-blank title text from a runtime default, unless known to be hidden', () => {
	const named = title(fact('Units', '$.y.title'));
	assert.deepEqual(codes(chart(title(fact('Chart title', '$.title', 'default')), named)), [
		'VIS_PLACEHOLDER_TEXT $.title'
	]);
	assert.deepEqual(codes(chart(title(fact('Sales', '$.title')), title(fact('Values', '$.y.title', 'default')))), [
		'VIS_PLACEHOLDER_TEXT $.y.title'
	]);
	assert.deepEqual(codes(chart(title(fact('Chart title', '$.title', 'default'), fact(false, '$.show')), named)), []);
	// A default that is blank is not a placeholder (Chart.js, ECharts).
	assert.deepEqual(codes(chart(title(fact('Sales', '$.title')), title(fact('', '$.y.title', 'default')))), []);
});

test('value axis untitled: only when neither the axis nor the chart has a title known to show', () => {
	const blank = title(fact('', '$.y.title', 'default'));
	assert.deepEqual(codes(chart(title(fact('', '$.title', 'default')), blank)), ['VIS_VALUE_AXIS_UNTITLED $.y.title']);
	assert.deepEqual(codes(chart(title(fact('Sales', '$.title'), fact(false, '$.show', 'default')), blank)), [
		'VIS_VALUE_AXIS_UNTITLED $.y.title'
	]);
	assert.deepEqual(codes(chart(title(fact('Sales (units)', '$.title')), blank)), []);
	assert.deepEqual(codes(chart(title(none('$.title')), blank)), []);
	assert.deepEqual(
		codes(chart(title(fact('', '$.title', 'default')), title(fact('Units', '$.y.title'), fact(false, '$.y.display')))),
		['VIS_VALUE_AXIS_UNTITLED $.y.title']
	);
});
