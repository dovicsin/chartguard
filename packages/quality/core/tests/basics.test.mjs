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
const series = (kind, valueAxis, orientation = fact('vertical', '$.o')) => ({
	path: '$.s',
	type: fact(kind, '$.t'),
	kind: fact(kind, '$.t'),
	name: none('$.n'),
	valueAxis,
	orientation,
	color: none('$.color')
});
const axis = (key, min, extra = {}) => ({
	key,
	path: `$.${key}`,
	scale: none('$.scale'),
	min,
	max: none('$.max'),
	reversed: none('$.reversed'),
	title: { text: none('$.title'), shown: none('$.shown') },
	...extra
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

test('bar baseline: a configured non-zero minimum of an axis a bar series is measured on, once per axis', () => {
	const axes = [axis('y', fact(60, '$.y.min')), axis('y2', fact(5, '$.y2.min'))];
	const bars = [series('bar', fact('y', '$.a')), series('bar', fact('y', '$.b')), series('line', fact('y2', '$.c'))];
	// Once for the bars' axis; the line's axis starts at 5 but carries no bar (it is a second value axis).
	assert.deepEqual(codes(review(chart({ items: bars, axes }))), ['VIS_BAR_BASELINE $.y.min', 'VIS_DUAL_AXIS $.c']);
});

test('bar baseline: only a range that excludes zero (min above it, max below it, or the data minimum)', () => {
	const bar = [series('bar', fact('y', '$.a'))];
	const run = (extra) => codes(review(chart({ items: bar, axes: [axis('y', none('$.y.min'), extra)] })));
	// Bars start from zero while zero is in range: a negative minimum truncates nothing.
	assert.deepEqual(run({ min: fact(-10, '$.y.min') }), []);
	assert.deepEqual(run({ min: fact('data', '$.y.min') }), ['VIS_BAR_BASELINE $.y.min']);
	assert.deepEqual(run({ max: fact(-5, '$.y.max') }), ['VIS_BAR_BASELINE $.y.max']);
	assert.deepEqual(run({ max: fact(5, '$.y.max') }), []);
	// A logarithmic axis is reported by its own rule, not as a baseline.
	assert.deepEqual(run({ min: fact(10, '$.y.min'), scale: fact('log', '$.y.type') }), ['VIS_BAR_LOG_SCALE $.y.type']);
});

test('reversed value axes and dual axes are reported where the config sets them', () => {
	const reversed = axis('y', none('$.y.min'), { reversed: fact(true, '$.y.reverse') });
	assert.deepEqual(codes(review(chart({ items: [series('line', fact('y', '$.a'))], axes: [reversed] }))), [
		'VIS_REVERSED_VALUE_AXIS $.y.reverse'
	]);
	assert.deepEqual(
		codes(
			review(
				chart({
					items: [series('line', fact('y', '$.a'))],
					axes: [axis('y', none('$.m'), { reversed: fact(true, '$.r', 'default') })]
				})
			)
		),
		[]
	);
	const two = [series('bar', fact('y', '$.a')), series('line', fact('y2', '$.b'))];
	assert.deepEqual(codes(review(chart({ items: two, axes: [axis('y', none('$.m')), axis('y2', none('$.m'))] }))), [
		'VIS_DUAL_AXIS $.b'
	]);
	// Different orientations, or an orientation not known, are not two axes of one plot.
	const crossed = [series('bar', fact('y', '$.a')), series('bar', fact('x', '$.b'), fact('horizontal', '$.o'))];
	assert.deepEqual(
		codes(review(chart({ items: crossed, axes: [axis('y', none('$.m')), axis('x', none('$.m'))] }))),
		[]
	);
	const unknownOrientation = [
		series('bar', fact('y', '$.a'), none('$.o')),
		series('line', fact('y2', '$.b'), none('$.o'))
	];
	assert.deepEqual(
		codes(review(chart({ items: unknownOrientation, axes: [axis('y', none('$.m')), axis('y2', none('$.m'))] }))),
		[]
	);
});

test('the rule catalog: every rule has a unique id and code, an advisory severity, sources and documented limits', async () => {
	const { RULE_CATALOG } = await import('../dist/index.js');
	assert.ok(RULE_CATALOG.length >= 5);
	assert.equal(new Set(RULE_CATALOG.map(({ id }) => id)).size, RULE_CATALOG.length);
	assert.equal(new Set(RULE_CATALOG.map(({ code }) => code)).size, RULE_CATALOG.length);
	for (const rule of RULE_CATALOG) {
		assert.match(rule.code, /^VIS_[A-Z_]+$/, rule.id);
		assert.ok(['warning', 'info'].includes(rule.severity), rule.id);
		assert.ok(rule.title.length > 0 && rule.rationale.length > 40, rule.id);
		assert.ok(
			rule.evidence.length > 0 &&
				rule.evidence.every((source) => source.title && source.authors && source.venue && source.year > 1900),
			rule.id
		);
		assert.ok(rule.limits.length > 0, rule.id);
		assert.equal('check' in rule, false);
	}
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

test('an option resolved through scopes: the first scope that sets it; an unreadable one before decides; else the default', async () => {
	const { firstSet } = await import('../dist/index.js');
	const config = { series: [{}], plotOptions: { line: { stacking: 'normal' }, series: { stacking: 'percent' } } };
	const scopes = (root) =>
		[
			['series', 0],
			['plotOptions', 'line'],
			['plotOptions', 'series']
		].map((path) => readFact(root, [...path, 'stacking'], (v) => typeof v === 'string'));
	assert.equal(firstSet(scopes(config)).path, '$.plotOptions.line.stacking');
	const hidden = { ...config, series: [Object.defineProperty({}, 'stacking', { get: () => 'x' })] };
	assert.deepEqual(firstSet(scopes(hidden)), { known: false, path: '$.series[0].stacking', reason: 'accessor' });
	assert.deepEqual(firstSet(scopes({ series: [{}] }), DEFAULT), {
		known: true,
		value: 0,
		path: '$.series[0].stacking',
		source: 'default',
		pointer: DEFAULT.pointer
	});
	assert.deepEqual(firstSet(scopes({ series: [{}] })), { known: false, path: '$.series[0].stacking', reason: 'unset' });
});

test('the README lists every rule of the catalog', async () => {
	const { readFileSync } = await import('node:fs');
	const { RULE_CATALOG } = await import('../dist/index.js');
	const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
	for (const { id, code } of RULE_CATALOG) assert.ok(readme.includes(`| \`${id}\` | \`${code}\` |`), id);
});
