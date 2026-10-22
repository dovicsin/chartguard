import assert from 'node:assert/strict';
import test from 'node:test';

import { review } from '../dist/index.js';

/** Series values and the rules that read them (CG-05-04 part 2). */
const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unset') => ({ known: false, path, reason });
const series = (kind, valueAxis, orientation = fact('vertical', '$.o')) => ({
	path: '$.s',
	type: fact(kind, '$.t'),
	kind: fact(kind, '$.t'),
	name: none('$.n'),
	stacking: none('$.stack'),
	base: none('$.base'),
	valueAxis,
	orientation,
	color: none('$.color')
});
const chart = ({ items = [], axes = [], text = none('$.title.text'), shown = none('$.title.show') } = {}) => ({
	library: 't',
	title: { text, shown },
	series: { known: true, path: '$.series', items },
	axes,
	background: none('$.background'),
	motion: { endless: none('$.endless'), longest: none('$.longest') },
	access: { dataDescribed: none('$.access'), keyboard: none('$.keyboard') }
});
const codes = (report) => report.diagnostics.map((d) => `${d.code} ${d.path}`);

test('values: numbers and gaps are read element by element; one unreadable element leaves the summary unknown', async () => {
	const { numberElement, valuesAt } = await import('../dist/index.js');
	const read = (element, path) => {
		const value = numberElement(element, path);
		return value === undefined ? none('?', 'unmodelled') : value;
	};
	assert.deepEqual(valuesAt({}, ['data'], read), fact({ count: 0, min: undefined, max: undefined }, '$.data'));
	const summary = valuesAt({ data: [3, null, -1, Number.NaN, 7, undefined] }, ['data'], read);
	assert.deepEqual(
		summary,
		fact({ count: 3, min: { value: -1, path: '$.data[2]' }, max: { value: 7, path: '$.data[4]' } }, '$.data')
	);
	// Holes are gaps too.
	const holed = [1, 9, 2];
	delete holed[1];
	assert.equal(valuesAt({ data: holed }, ['data'], read).value.count, 2);
	assert.deepEqual(valuesAt({ data: [1, 'x'] }, ['data'], read), none('?', 'unmodelled'));
	let reads = 0;
	const hidden = Object.defineProperty([1, 2], '1', { get: () => ((reads += 1), 2) });
	assert.deepEqual(valuesAt({ data: hidden }, ['data'], read), none('$.data', 'accessor'));
	assert.equal(reads, 0);
	assert.deepEqual(valuesAt({ data: { a: 1 } }, ['data'], read), none('$.data', 'shape'));
	assert.deepEqual(valuesAt({ data: () => [] }, ['data'], read), none('$.data', 'dynamic'));
});

test('pie negative: the smallest value of a pie series when it is below zero', () => {
	const pie = (values, kind = 'pie') => ({ ...series(kind, none('$.a', 'inapplicable')), values });
	const summary = (min) =>
		fact({ count: 3, min: { value: min, path: '$.data[1]' }, max: { value: 5, path: '$.data[0]' } }, '$.data');
	assert.deepEqual(codes(review(chart({ items: [pie(summary(-2))] }))), ['VIS_PIE_NEGATIVE $.data[1]']);
	assert.deepEqual(codes(review(chart({ items: [pie(summary(0))] }))), []);
	assert.deepEqual(codes(review(chart({ items: [pie(summary(-2), 'bar')] }))), []);
	assert.deepEqual(codes(review(chart({ items: [pie(none('$.data', 'unmodelled'))] }))), []);
});
