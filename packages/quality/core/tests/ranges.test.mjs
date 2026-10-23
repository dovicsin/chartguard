import assert from 'node:assert/strict';
import test from 'node:test';

import { review } from '../dist/index.js';
import { axis, chart, fact, none, series } from './fixtures/semantics.mjs';

/** Ranges fitted to the data, bar bases and units (CG-05-04 part 8). */
const codes = (report) => report.diagnostics.map((d) => `${d.code} ${d.path}`);

test('bar baseline: a range fitted to the data that excludes zero at every size, and a configured base other than zero', () => {
	const bar = (base = none('$.base')) => ({ ...series('bar', fact('y', '$.a')), base });
	const run = (extra, items = [bar()]) => codes(review(chart({ items, axes: [axis('y', none('$.y.min'), extra)] })));
	assert.deepEqual(run({ fit: fact('excluded', '$.y.scale') }), ['VIS_BAR_BASELINE $.y.scale']);
	assert.deepEqual(run({ fit: fact('included', '$.y.scale') }), []);
	assert.deepEqual(run({ fit: none('$.y.scale', 'layout') }), []);
	// A configured bound comes first: one finding per axis.
	assert.deepEqual(run({ min: fact(5, '$.y.min'), fit: fact('excluded', '$.y.scale') }), ['VIS_BAR_BASELINE $.y.min']);
	assert.deepEqual(run({}, [bar(fact(20, '$.s.base'))]), ['VIS_BAR_BASELINE $.s.base']);
	assert.deepEqual(run({}, [bar(fact(-20, '$.s.base'))]), ['VIS_BAR_BASELINE $.s.base']);
	assert.deepEqual(run({}, [bar(fact(0, '$.s.base')), bar(fact(20, '$.s.base', 'default'))]), []);
	// A base shared by its bars (ECharts `startValue`) is one finding; the axis and the base are two causes.
	assert.deepEqual(
		run({ fit: fact('excluded', '$.y.scale') }, [bar(fact(20, '$.y.startValue')), bar(fact(20, '$.y.startValue'))]),
		['VIS_BAR_BASELINE $.y.scale', 'VIS_BAR_BASELINE $.y.startValue']
	);
	// Not for lines, not on a log axis, not for a bar whose axis is not known.
	assert.deepEqual(run({}, [{ ...series('line', fact('y', '$.a')), base: fact(20, '$.s.base') }]), []);
	assert.deepEqual(run({ scale: fact('log', '$.y.type') }, [bar(fact(20, '$.s.base'))]), [
		'VIS_BAR_LOG_SCALE $.y.type'
	]);
	assert.deepEqual(run({}, [{ ...series('bar', none('$.a')), base: fact(20, '$.s.base') }]), []);
});

test('percent without unit: a percent-stacked series on an axis whose labels and title are known to show no %', () => {
	const stacked = (stacking) => ({ ...series('area', fact('y', '$.a')), stacking });
	const run = (extra, stacking = fact('percent', '$.stacking')) =>
		codes(
			review(
				chart({
					items: [stacked(stacking)],
					axes: [
						axis('y', none('$.y.min'), {
							unit: fact('', '$.y.unit', 'default'),
							title: { text: fact('Share', '$.y.title'), shown: none('$.s') },
							...extra
						})
					],
					text: fact('T', '$.title.text')
				})
			)
		);
	assert.deepEqual(run({}), ['VIS_PERCENT_WITHOUT_UNIT $.y.unit']);
	assert.deepEqual(run({ unit: fact('%', '$.y.unit') }), []);
	assert.deepEqual(run({ unit: fact('pct', '$.y.unit') }), ['VIS_PERCENT_WITHOUT_UNIT $.y.unit']);
	assert.deepEqual(run({ title: { text: fact('Share (%)', '$.y.title'), shown: none('$.s') } }), []);
	assert.deepEqual(run({ unit: none('$.y.unit', 'dynamic') }), []);
	assert.deepEqual(run({ title: { text: none('$.y.title', 'accessor'), shown: none('$.s') } }), []);
	assert.deepEqual(run({}, fact('stacked', '$.stacking')), []);
	assert.deepEqual(run({}, none('$.stacking', 'unmodelled')), []);
});

test('dataRange: the values of the series on one axis, as a fitted range starts from them', async () => {
	const { dataRange } = await import('../dist/index.js');
	const valued = (kind, key, [min, max], extra = {}) => ({
		...series(kind, key === undefined ? none('$.a') : fact(key, '$.a')),
		stacking: fact('none', '$.stack'),
		values: fact({ count: 2, min: { value: min, path: '$.min' }, max: { value: max, path: '$.max' } }, '$.v'),
		...extra
	});
	const list = (...items) => ({ known: true, path: '$.series', items });
	const range = (...items) => {
		const result = dataRange(list(...items), 'y', '$.y.fit');
		return result.known ? result.value : result.reason;
	};
	assert.deepEqual(
		range(valued('bar', 'y', [60, 70]), valued('line', 'y', [1, 2]), valued('bar', 'y2', [-5, 500])),
		[1, 70]
	);
	assert.deepEqual(range(valued('bar', 'y', [60, 70]), valued('pie', undefined, [-5, 5])), [60, 70]);
	assert.equal(range(valued('bar', 'y', [60, 70]), valued('scatter', 'y2', [1, 2])), 'unmodelled');
	assert.equal(range(valued('bar', 'y', [60, 70]), valued('line', undefined, [1, 2])), 'unmodelled');
	assert.equal(range(valued('bar', 'y', [60, 70], { stacking: fact('stacked', '$.s') })), 'unmodelled');
	assert.equal(range(valued('bar', 'y', [60, 70], { values: none('$.v', 'accessor') })), 'accessor');
	assert.equal(range(valued('bar', 'y2', [60, 70])), 'unmodelled');
	assert.equal(dataRange({ known: false, path: '$.series', reason: 'dynamic' }, 'y', '$.f').reason, 'dynamic');
});

test('zeroFit: excluded when every range leaves zero out, included when none does, else it depends on the size', async () => {
	const { zeroFit } = await import('../dist/index.js');
	const asked = fact(false, '$.y.beginAtZero');
	const where = (ranges) => {
		const result = zeroFit(ranges, asked);
		return result.known ? `${result.value} ${result.path}` : `? ${result.reason} ${result.path}`;
	};
	assert.equal(
		where([
			[50, 80],
			[60, 70]
		]),
		'excluded $.y.beginAtZero'
	);
	assert.equal(where([[-80, -50]]), 'excluded $.y.beginAtZero');
	assert.equal(
		where([
			[0, 80],
			[-10, 70]
		]),
		'included $.y.beginAtZero'
	);
	assert.equal(
		where([
			[0, 80],
			[30, 70]
		]),
		'? layout $.y.beginAtZero'
	);
});

test('bar baseline: an axis that starts (or ends) at the data cuts the bars only when the data lies above (or below) zero (H8)', () => {
	const bar = (min, max) => ({
		...series('bar', fact('y', '$.a')),
		stacking: fact('none', '$.stack'),
		values: fact({ count: 2, min: { value: min, path: '$.v0' }, max: { value: max, path: '$.v1' } }, '$.v')
	});
	const run = (bounds, item) => codes(review(chart({ items: [item], axes: [axis('y', none('$.y.min'), bounds)] })));
	assert.deepEqual(run({ min: fact('data', '$.y.min') }, bar(60, 70)), ['VIS_BAR_BASELINE $.y.min']);
	// Negative data: the axis starts below zero and the bars grow from zero.
	assert.deepEqual(run({ min: fact('data', '$.y.min') }, bar(-5, 10)), []);
	assert.deepEqual(run({ min: fact('data', '$.y.min') }, bar(0, 10)), []);
	assert.deepEqual(run({ max: fact('data', '$.y.max') }, bar(-60, -50)), ['VIS_BAR_BASELINE $.y.max']);
	assert.deepEqual(run({ max: fact('data', '$.y.max') }, bar(-60, 5)), []);
	// Values that are not known, or stacked: nothing is claimed.
	assert.deepEqual(run({ min: fact('data', '$.y.min') }, { ...bar(60, 70), values: none('$.v', 'unmodelled') }), []);
	assert.deepEqual(run({ min: fact('data', '$.y.min') }, { ...bar(60, 70), stacking: fact('stacked', '$.s') }), []);
});

test('dual axis: two value axes count only when they span one panel; separate grids, bands or panes are separate charts (H9)', () => {
	const two = [series('bar', fact('y', '$.a')), series('line', fact('y2', '$.b'))];
	const run = (first, second) =>
		codes(
			review(
				chart({
					items: two,
					axes: [axis('y', none('$.m'), { panel: first }), axis('y2', none('$.m'), { panel: second })]
				})
			)
		);
	assert.deepEqual(run(fact('plot', '$.p', 'default'), fact('plot', '$.p', 'default')), ['VIS_DUAL_AXIS $.b']);
	assert.deepEqual(run(fact('grid[0]', '$.p'), fact('grid[1]', '$.p')), []);
	assert.deepEqual(run(fact('plot', '$.p', 'default'), none('$.p', 'accessor')), []);
	assert.deepEqual(run(none('$.p', 'dynamic'), fact('plot', '$.p', 'default')), []);
});
