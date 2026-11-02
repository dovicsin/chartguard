import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '@chartguard/config-echarts';
import * as echarts from 'echarts';

import artifact from '../../../packages/config/echarts/src/generated/echarts-6.1.0.json' with { type: 'json' };
import { observe } from '../lib/capture.mjs';

/**
 * The premises of CG-02-10 and CG-02-11 on the pinned echarts runtime, not on a model of it: every
 * component option given each kind of value that is not an object, alone and listed. Where the
 * schema says the runtime skips it, the validator reports only `CFG_INEFFECTIVE` and echarts draws
 * exactly what it draws without the option, with no error or warning; everywhere else the validator
 * reports a confirmed error and echarts throws or draws something for it.
 */
const option = artifact.definitions[artifact.root.ref];
const KINDS = { null: [null], falsy: [0, '', false], truthy: [5, 'x', true] };

/** What echarts does with `setOption(value)`: whether it threw, what it logged, and what it drew. */
function render(value) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	let drawn = '';
	try {
		const { threw, messages } = observe(() => {
			chart.setOption(value);
			drawn = chart.renderToSVGString();
		});
		return {
			threw: threw !== undefined,
			logged: messages.map(({ text }) => text),
			drawn: threw === undefined ? drawn : ''
		};
	} finally {
		chart.dispose();
	}
}
/** The chart without the option: what a skipped value must leave unchanged. */
const NOTHING = render({}).drawn;

const components = Object.entries(option.properties).filter(([, property]) => property.skips !== undefined);

test('the schema states what echarts skips for every component option it models as a component', () => {
	assert.equal(components.length, 26);
});

/** Whether the option takes a list (`T | T[]`): the declarations make a list of a single-value option a type error. */
const takesList = (key) =>
	!validate({ [key]: [{}] }).diagnostics.some((d) => d.path === `$.${key}` && d.code === 'CFG_TYPE');

/** One value of one kind, given at one place: what the validator and echarts must agree on. */
function checkValue(key, skips, { kind, where, config, path }) {
	const label = `${key}: ${JSON.stringify(config[key])}`;
	const findings = validate(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
	const outcome = render(config);
	// A `null` given alone is absent: no finding, nothing drawn.
	if (where === 'value' && kind === 'null') {
		assert.deepEqual([findings, outcome.threw, outcome.drawn], [[], false, NOTHING], label);
		return;
	}
	if (skips[where].includes(kind)) {
		assert.deepEqual(findings, [`warning CFG_INEFFECTIVE ${path}`], label);
		assert.deepEqual([outcome.threw, outcome.logged, outcome.drawn], [false, [], NOTHING], label);
		return;
	}
	// Not skipped: the runtime throws on it, or it changes what is drawn; never ignored.
	assert.ok(
		findings.some((finding) => finding.startsWith(`error CFG_TYPE ${path}`)),
		`${label}: ${findings.join(', ')}`
	);
	assert.ok(outcome.threw || outcome.drawn !== NOTHING, label);
}

for (const [key, { skips }] of components)
	test(`${key}: a value that is not an object is skipped exactly where the schema says, and thrown on elsewhere`, () => {
		const places = [
			{ where: 'value', wrap: (value) => value, path: `$.${key}` },
			...(takesList(key) ? [{ where: 'entries', wrap: (value) => [value], path: `$.${key}[0]` }] : [])
		];
		const cases = Object.entries(KINDS).flatMap(([kind, values]) =>
			places.flatMap(({ where, wrap, path }) =>
				values.map((value) => ({ kind, where, path, config: { [key]: wrap(value) } }))
			)
		);
		for (const entry of cases) checkValue(key, skips, entry);
	});

/** The pie series echarts builds: the emphasis scale size it reads. */
function scaleSizeOf(series) {
	const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 300 });
	try {
		chart.setOption({ series: [series] });
		return chart.getModel().getSeriesByIndex(0).get(['emphasis', 'scaleSize']);
	} finally {
		chart.dispose();
	}
}

test('hoverOffset on a pie is never applied, and it sets emphasis.scaleSize to null: the pie no longer grows on hover (CG-02-11)', () => {
	const pie = { type: 'pie', data: [1, 2] };
	assert.equal(scaleSizeOf(pie), 5);
	assert.equal(scaleSizeOf({ ...pie, emphasis: { scaleSize: 4 } }), 4);
	// The hover radius is `r + (scaleSize || 0)`: with hoverOffset, whatever it and scaleSize say, it grows by nothing.
	assert.equal(scaleSizeOf({ ...pie, hoverOffset: 12 }) || 0, 0);
	assert.equal(scaleSizeOf({ ...pie, hoverOffset: 12, emphasis: { scaleSize: 4 } }) || 0, 0);
	assert.deepEqual(
		validate({ series: [{ ...pie, hoverOffset: 12, emphasis: { scaleSize: 4 } }] }).diagnostics.map(
			(d) => `${d.code} ${d.path}`
		),
		['CFG_INEFFECTIVE $.series[0].hoverOffset', 'CFG_INEFFECTIVE $.series[0].emphasis.scaleSize']
	);
	// An unset or null hoverOffset leaves it.
	assert.equal(scaleSizeOf({ ...pie, hoverOffset: null, emphasis: { scaleSize: 4 } }), 4);
});
