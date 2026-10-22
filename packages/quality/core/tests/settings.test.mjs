import assert from 'node:assert/strict';
import test from 'node:test';

import { assertQualityOptions, QualityOptionsError, review, RULE_CATALOG, SEVERITY_OF_IMPACT } from '../dist/index.js';
import { axis, chart, fact, none, series } from './fixtures/semantics.mjs';

/** Rule severity, suppression and context (CG-05-05). */

/** Bars on an axis from 5 (bar-baseline, warning) under a blank title (empty-title, info). */
const bars = (extra = {}) =>
	chart({
		items: [series('bar', fact('y', '$.a'))],
		axes: [axis('y', fact(5, '$.options.scales.y.min'))],
		text: fact('', '$.options.plugins.title.text'),
		...extra
	});
const brief = ({ code, severity, path }) => `${code} ${severity} ${path}`;
const reported = (report) => report.diagnostics.map(brief);
const held = (report) =>
	report.suppressed.map(({ diagnostic, by, reason }) => `${brief(diagnostic)} by ${by}: ${reason}`);

/** The problems an options value has, or [] when it is accepted. */
function problems(options) {
	try {
		assertQualityOptions(options);
		return [];
	} catch (error) {
		assert.ok(error instanceof QualityOptionsError);
		assert.ok(error instanceof TypeError);
		assert.equal(error.name, 'QualityOptionsError');
		assert.ok(error.message.includes(error.problems[0]));
		return error.problems;
	}
}

test('without options every rule runs at its catalog severity; nothing is suppressed or disabled', () => {
	const report = review(bars());
	assert.deepEqual(reported(report), [
		'VIS_BAR_BASELINE warning $.options.scales.y.min',
		'VIS_EMPTY_TITLE info $.options.plugins.title.text'
	]);
	assert.deepEqual([report.suppressed, report.disabled], [[], []]);
	assert.deepEqual(reported(review(bars(), {})), reported(report));
	assert.equal(report.rulesVersion, 'quality-0.6');
});

test('levels: off does not run the rule; info and warning set the severity of its findings', () => {
	const off = review(bars(), { rules: { 'bar-baseline': 'off' } });
	assert.deepEqual(reported(off), ['VIS_EMPTY_TITLE info $.options.plugins.title.text']);
	assert.deepEqual([off.disabled, off.suppressed], [['bar-baseline'], []]);
	const levels = review(bars(), { rules: { 'bar-baseline': { level: 'info' }, 'empty-title': 'warning' } });
	assert.deepEqual(reported(levels), [
		'VIS_BAR_BASELINE info $.options.scales.y.min',
		'VIS_EMPTY_TITLE warning $.options.plugins.title.text'
	]);
	// Disabled rules are listed in catalog order.
	const two = review(bars(), { rules: { 'empty-title': 'off', 'bar-baseline': 'off' } });
	assert.deepEqual([two.diagnostics, two.disabled], [[], ['bar-baseline', 'empty-title']]);
});

test('ignore: a finding at the path or inside it is suppressed with its reason; a sibling key with the same prefix is not', () => {
	const ignore = (path) => ({
		rules: { 'bar-baseline': { ignore: [{ path, reason: 'Stock prices: the change matters.' }] } }
	});
	const at = review(bars(), ignore('$.options.scales.y.min'));
	assert.deepEqual(reported(at), ['VIS_EMPTY_TITLE info $.options.plugins.title.text']);
	assert.deepEqual(held(at), [
		'VIS_BAR_BASELINE warning $.options.scales.y.min by setting: Stock prices: the change matters.'
	]);
	assert.deepEqual(held(review(bars(), ignore('$.options.scales'))).length, 1);
	assert.deepEqual(held(review(bars(), ignore('$'))).length, 1);
	// Paths are compared segment by segment: `$.options.scales.y` does not contain `$.options.scales.y2`.
	const y2 = bars({
		axes: [axis('y2', fact(5, '$.options.scales.y2.min'))],
		items: [series('bar', fact('y2', '$.a'))]
	});
	assert.deepEqual(held(review(y2, ignore('$.options.scales.y'))), []);
	assert.deepEqual(held(review(bars(), ignore('$.options.scales.y.min.x'))), []);
	// An ignore belongs to its rule: it suppresses nothing of another.
	const other = review(bars(), { rules: { 'empty-title': { ignore: [{ path: '$.options.scales', reason: 'r' }] } } });
	assert.deepEqual(held(other), []);
	// The level applies to what is suppressed too.
	const both = review(bars(), { rules: { 'bar-baseline': { level: 'info', ignore: [{ path: '$', reason: 'r' }] } } });
	assert.deepEqual(held(both), ['VIS_BAR_BASELINE info $.options.scales.y.min by setting: r']);
});

/** A light grey line on the given background. */
const contrast = (background) => ({
	...chart({
		items: [
			{
				...series('line', fact('y', '$.a')),
				shades: fact({ light: fact('#eeeeee', '$.c'), dark: fact('#eeeeee', '$.c') }, '$.c')
			}
		],
		text: fact('Sales', '$.title')
	}),
	background
});

test('context background: fills a background left to the page, per declared scheme; never one the config decides', () => {
	const codes = (report) =>
		report.diagnostics.map(
			({ code, message }) => `${code} ${message.slice(message.indexOf('(') + 1, message.indexOf(';'))}`
		);
	const page = none('$', 'page');
	assert.deepEqual(codes(review(contrast(page))), []);
	assert.deepEqual(codes(review(contrast(page), { context: { background: '#ffffff' } })), [
		'VIS_LOW_CONTRAST_SERIES 1.16:1 in the light scheme, 1.16:1 in the dark scheme'
	]);
	assert.deepEqual(codes(review(contrast(page), { context: { background: { dark: '#000000' } } })), []);
	assert.deepEqual(codes(review(contrast(page), { context: { background: { light: '#ffffff', dark: '#000000' } } })), [
		'VIS_LOW_CONTRAST_SERIES 1.16:1 in the light scheme'
	]);
	// A background the config decides, or one not modelled, is never replaced.
	const black = fact({ light: fact('#000000', '$.bg'), dark: fact('#000000', '$.bg') }, '$.bg');
	assert.deepEqual(codes(review(contrast(black), { context: { background: '#ffffff' } })), []);
	assert.deepEqual(codes(review(contrast(none('$.bg', 'unmodelled')), { context: { background: '#ffffff' } })), []);
});

const access = (dataDescribed) => ({
	...chart({ text: fact('Sales', '$.title') }),
	access: { dataDescribed, keyboard: none('$', 'page') }
});

test('context describesData: false fills a description left to the page; true meets the rule, even over the config', () => {
	const run = (dataDescribed, context) => {
		const report = review(access(dataDescribed), context === undefined ? undefined : { context });
		return [reported(report), held(report).map((line) => line.slice(0, line.indexOf(':')))];
	};
	assert.deepEqual(run(none('$', 'page')), [[], []]);
	assert.deepEqual(run(none('$', 'page'), { describesData: false }), [['VIS_DATA_NOT_DESCRIBED warning $'], []]);
	assert.deepEqual(run(none('$', 'page'), { describesData: true }), [[], []]);
	// The config turns description off; the page describes the data: met by context, kept as suppressed.
	assert.deepEqual(run(fact(false, '$.aria.enabled'), { describesData: true }), [
		[],
		['VIS_DATA_NOT_DESCRIBED warning $.aria.enabled by context']
	]);
	assert.deepEqual(run(fact(false, '$.aria.enabled'), { describesData: false }), [
		['VIS_DATA_NOT_DESCRIBED warning $.aria.enabled'],
		[]
	]);
	// A fact the config decides, or one not modelled, is never filled.
	assert.deepEqual(run(none('$', 'unmodelled'), { describesData: false }), [[], []]);
});

test('context pausesMotion: a control the page gives meets long-motion; the finding is kept as suppressed', () => {
	const moving = {
		...chart({ text: fact('Sales', '$.title') }),
		motion: { endless: fact(true, '$.animation.loop'), longest: none('$.d') }
	};
	assert.deepEqual(reported(review(moving)), ['VIS_LONG_MOTION warning $.animation.loop']);
	const paused = review(moving, { context: { pausesMotion: true } });
	assert.deepEqual(reported(paused), []);
	assert.match(
		held(paused)[0],
		/^VIS_LONG_MOTION warning \$\.animation\.loop by context: context\.pausesMotion: `true`: the page gives a control/u
	);
	assert.deepEqual(reported(review(moving, { context: { pausesMotion: false } })), [
		'VIS_LONG_MOTION warning $.animation.loop'
	]);
	// Off wins: a rule that does not run has nothing to suppress.
	const off = review(moving, { rules: { 'long-motion': 'off' }, context: { pausesMotion: true } });
	assert.deepEqual([off.suppressed, off.disabled], [[], ['long-motion']]);
});

test('options are checked: every problem is listed with where it is, and nothing runs', () => {
	assert.deepEqual(problems(undefined), []);
	assert.deepEqual(problems({ rules: {}, context: {} }), []);
	assert.deepEqual(problems([]), ['options: must be an object']);
	assert.deepEqual(problems({ rule: {}, context: { background: '#fff', dark: true } }), [
		'options.rule: is not an option (rules, context)',
		'options.context.dark: is not a context fact (background, describesData, pausesMotion)'
	]);
	assert.deepEqual(
		problems({
			rules: {
				VIS_BAR_BASELINE: 'off',
				'bar-baseline': 'error',
				'empty-title': { level: 'loud', mute: true },
				'dual-axis': {
					ignore: [{ path: 'options.y' }, { path: '$.y', reason: ' ' }, { path: '$.y', reason: 'r', why: 1 }]
				},
				'pie-negative': { ignore: { path: '$', reason: 'r' } }
			}
		}),
		[
			`options.rules.VIS_BAR_BASELINE: is not a rule id (${RULE_CATALOG.map(({ id }) => id).join(', ')})`,
			'options.rules["bar-baseline"]: must be one of off, info, warning (quality findings are advisory: never error)',
			'options.rules["empty-title"].mute: is not a rule setting (level, ignore)',
			'options.rules["empty-title"].level: must be one of off, info, warning (quality findings are advisory: never error)',
			'options.rules["dual-axis"].ignore[0].path: must be a path in the finding notation, such as $.options.scales.y.min',
			'options.rules["dual-axis"].ignore[0].reason: must say why the finding is ignored',
			'options.rules["dual-axis"].ignore[1].reason: must say why the finding is ignored',
			'options.rules["dual-axis"].ignore[2].why: is not an ignore field (path, reason)',
			'options.rules["pie-negative"].ignore: must be a list of { path, reason }'
		]
	);
	assert.deepEqual(problems({ context: { background: 'red', describesData: 'yes', pausesMotion: 1 } }), [
		'options.context.background: must be an opaque hex or rgb() colour',
		'options.context.describesData: must be true or false',
		'options.context.pausesMotion: must be true or false'
	]);
	assert.deepEqual(problems({ context: { background: { light: 'rgba(0, 0, 0, 0.5)', sepia: '#000' } } }), [
		'options.context.background.sepia: is not a colour scheme (light, dark)',
		'options.context.background.light: must be an opaque hex or rgb() colour'
	]);
	assert.deepEqual(problems({ context: { background: {} } }), [
		'options.context.background: must name a colour for light, dark or both'
	]);
	const getter = Object.defineProperty({}, 'rules', { get: () => ({}), enumerable: true });
	assert.deepEqual(problems(getter), ['options.rules: is behind a getter, which is never run']);
	// review and the adapters check the same way: a bad option throws before any rule runs.
	assert.throws(() => review(bars(), { rules: { 'bar-baseline': 'error' } }), QualityOptionsError);
});

test('the severity policy: a rule is a warning when it misleads or excludes, information when it omits or risks', () => {
	for (const { id, severity, impact, context } of RULE_CATALOG) {
		assert.equal(severity, SEVERITY_OF_IMPACT[impact], id);
		for (const { fact: declared, effect, note } of context) {
			assert.ok(['background', 'describesData', 'pausesMotion'].includes(declared), id);
			assert.ok(['supplies', 'satisfies'].includes(effect), id);
			assert.ok(note.length > 20, id);
			// Only a yes/no fact can meet a concern.
			if (effect === 'satisfies') assert.notEqual(declared, 'background', id);
		}
	}
	assert.deepEqual(
		RULE_CATALOG.filter(({ context }) => context.length > 0).map(({ id }) => id),
		['low-contrast-series', 'data-not-described', 'long-motion']
	);
});
