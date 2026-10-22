import assert from 'node:assert/strict';
import test from 'node:test';

import { pathSegments } from '@chartguard/core';

import { formatPath, itemsAt, readFact, readPath, review, valueOf } from '../dist/index.js';

const isNumber = (value) => typeof value === 'number';
const DEFAULT = { value: 0, pointer: 'lib@1.0.0 file.js:1 zero' };

test('a fact is known from the config, the runtime default when unset, or unknown with why', () => {
	const config = { a: { n: 3, s: 'x', f: () => 1 }, p: 5 };
	Object.defineProperty(config.a, 'hidden', { get: () => 1 });
	assert.deepEqual(readFact(config, ['a', 'n'], isNumber), { known: true, value: 3, path: '$.a.n', source: 'config' });
	assert.deepEqual(readFact(config, ['a', 'm'], isNumber, DEFAULT), {
		known: true,
		value: 0,
		path: '$.a.m',
		source: 'default',
		pointer: DEFAULT.pointer
	});
	assert.deepEqual(readFact(config, ['b', 'm'], isNumber, DEFAULT).source, 'default');
	assert.deepEqual(readFact(config, ['a', 'm'], isNumber), { known: false, path: '$.a.m', reason: 'unset' });
	assert.deepEqual(readFact(config, ['a', 'hidden'], isNumber, DEFAULT), {
		known: false,
		path: '$.a.hidden',
		reason: 'accessor'
	});
	assert.deepEqual(readFact(config, ['a', 'f'], isNumber).reason, 'dynamic');
	assert.deepEqual(readFact(config, ['a', 's'], isNumber).reason, 'shape');
	assert.deepEqual(readFact(config, ['p', 'q'], isNumber, DEFAULT).reason, 'shape');
});

test('a getter on the way is never run', () => {
	let reads = 0;
	const config = Object.defineProperty({}, 'a', { get: () => ((reads += 1), { n: 1 }) });
	assert.equal(readFact(config, ['a', 'n'], isNumber).reason, 'accessor');
	assert.equal(itemsAt(config, ['a']).reason, 'accessor');
	assert.equal(readPath(config, ['a', 'n']), undefined);
	assert.equal(reads, 0);
});

test('lists: missing is empty, a single object is one item where it is, anything else is unknown', () => {
	assert.deepEqual(itemsAt({}, ['series']), { known: true, path: '$.series', items: [] });
	const list = itemsAt({ series: [{ a: 1 }, 2] }, ['series']);
	assert.deepEqual(
		list.items.map(({ path, value }) => [path, value]),
		[
			['$.series[0]', { a: 1 }],
			['$.series[1]', 2]
		]
	);
	assert.deepEqual(
		itemsAt({ yAxis: { min: 1 } }, ['yAxis'], { single: true }).items.map(({ path, segments }) => [path, segments]),
		[['$.yAxis', ['yAxis']]]
	);
	assert.equal(itemsAt({ yAxis: { min: 1 } }, ['yAxis']).reason, 'shape');
	assert.equal(itemsAt({ series: 'x' }, ['series'], { single: true }).reason, 'shape');
	assert.equal(itemsAt({ series: () => [] }, ['series']).reason, 'dynamic');
});

test('paths are written in the engine syntax and name exactly one place (E29)', () => {
	for (const segments of [
		['options', 'scales', 'y-left', 'min'],
		['title', 'te.xt'],
		['series', 0, 'data', 2],
		['a b', '"q"']
	]) {
		assert.deepEqual(pathSegments(formatPath(segments)), segments);
	}
	assert.equal(formatPath(['options', 'scales', 'y-left']), '$.options.scales["y-left"]');
	assert.equal(formatPath([]), '$');
});

const fact = (value, path, source = 'config') => ({
	known: true,
	value,
	path,
	source,
	...(source === 'default' ? { pointer: 'p' } : {})
});
const none = (path, reason = 'unset') => ({ known: false, path, reason });
const series = (kind, valueAxis) => ({
	path: '$.s',
	type: fact(kind, '$.t'),
	kind: fact(kind, '$.t'),
	name: none('$.n'),
	valueAxis
});
const axis = (key, min) => ({ key, path: `$.${key}`, min, max: none('$.max'), title: none('$.title') });
const chart = ({ items = [], axes = [], text = none('$.title.text'), shown = none('$.title.show') } = {}) => ({
	library: 't',
	title: { text, shown },
	series: { known: true, path: '$.series', items },
	axes
});
const codes = (report) => report.diagnostics.map((d) => `${d.code} ${d.path}`);

test('bar baseline: a configured non-zero minimum of an axis a bar series is measured on, once per axis', () => {
	const axes = [axis('y', fact(60, '$.y.min')), axis('y2', fact(5, '$.y2.min'))];
	const bars = [series('bar', fact('y', '$.a')), series('bar', fact('y', '$.b')), series('line', fact('y2', '$.c'))];
	assert.deepEqual(codes(review(chart({ items: bars, axes }))), ['VIS_BAR_BASELINE $.y.min']);
});

test('bar baseline claims nothing on zero, a default, an unknown axis or an unknown series list', () => {
	const bar = [series('bar', fact('y', '$.a'))];
	assert.deepEqual(codes(review(chart({ items: bar, axes: [axis('y', fact(0, '$.y.min'))] }))), []);
	assert.deepEqual(codes(review(chart({ items: bar, axes: [axis('y', fact(60, '$.y.min', 'default'))] }))), []);
	assert.deepEqual(codes(review(chart({ items: bar, axes: [axis('y', none('$.y.min', 'accessor'))] }))), []);
	assert.deepEqual(
		codes(review(chart({ items: [series('bar', none('$.a', 'unmodelled'))], axes: [axis('y', fact(60, '$.y.min'))] }))),
		[]
	);
	assert.deepEqual(
		codes(review({ ...chart({ axes: [axis('y', fact(60, '$.y.min'))] }), series: none('$.series', 'accessor') })),
		[]
	);
});

test('empty title: blank text the config sets, unless the title is known to be hidden', () => {
	assert.deepEqual(codes(review(chart({ text: fact(' ', '$.title.text') }))), ['VIS_EMPTY_TITLE $.title.text']);
	assert.deepEqual(codes(review(chart({ text: fact(' ', '$.title.text'), shown: fact(true, '$.title.show') }))), [
		'VIS_EMPTY_TITLE $.title.text'
	]);
	assert.deepEqual(
		codes(review(chart({ text: fact('', '$.title.text'), shown: fact(false, '$.title.show', 'default') }))),
		[]
	);
	assert.deepEqual(codes(review(chart({ text: fact('', '$.title.text', 'default') }))), []);
	assert.deepEqual(codes(review(chart({ text: fact('Sales', '$.title.text') }))), []);
});

test('a report is advisory: it names its library and rules version and carries no verdict', () => {
	const report = review(chart({ text: fact('', '$.t') }));
	assert.deepEqual(Object.keys(report).sort(), ['diagnostics', 'library', 'rulesVersion']);
	assert.equal(report.library, 't');
	assert.ok(report.diagnostics.every((d) => d.severity !== 'error' && d.confidence === 'inferred'));
	assert.equal(valueOf(none('$.x')), undefined);
	assert.equal(valueOf(fact(2, '$.x')), 2);
});
