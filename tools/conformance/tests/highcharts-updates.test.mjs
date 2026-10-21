import assert from 'node:assert/strict';
import test from 'node:test';

import { checkUpdate } from '../../../packages/integrations/highcharts-runtime/dist/index.js';
import { browserSkipReason } from '../../shared/chrome.mjs';
import { runHighchartsUpdates } from '../lib/highcharts.mjs';

/**
 * `chart.update` series matching on the pinned Highcharts (CG-04-04): each case is applied in headless
 * Chrome, and `checkUpdate` on a chart in the recorded state must give every update item the type it
 * reached there, and report exactly the items it reached none of as ignored.
 */
const MIXED = { chart: { type: 'column' }, series: [{ type: 'line', id: 'a', data: [1] }, { data: [1, 2] }] };
const CASES = [
	{ name: 'untyped items take the type of the series at their index', create: MIXED, update: { series: [{}, {}] } },
	{ name: 'items beyond the series are ignored', create: MIXED, update: { series: [{}, {}, {}] } },
	{ name: 'with oneToOne, items beyond are added with the chart type', create: MIXED, update: { series: [{}, {}, {}] }, oneToOne: true },
	{
		name: "the update's chart type reaches the series without their own type",
		create: MIXED,
		update: { chart: { type: 'area' }, series: [{}, {}, {}] },
		oneToOne: true
	},
	{ name: 'an id reaches its series through chart.get', create: MIXED, update: { series: [{}, { id: 'a' }] } },
	{ name: 'an unknown id never takes a series that has another id', create: MIXED, update: { series: [{ id: 'b' }] } },
	{ name: 'with oneToOne, an unknown id is added', create: MIXED, update: { series: [{ id: 'b' }] }, oneToOne: true },
	{
		name: 'an id of an axis is ignored, even with oneToOne',
		create: { ...MIXED, xAxis: { id: 'x' } },
		update: { series: [{ id: 'x' }] },
		oneToOne: true
	},
	{ name: '`index` chooses the series', create: MIXED, update: { series: [{ index: 1 }] } },
	{ name: 'a single series object is item 0', create: MIXED, update: { series: {} } },
	{ name: 'an own type is kept', create: MIXED, update: { series: [{ type: 'area' }] } }
];

/** A chart in the state the browser recorded: what `checkUpdate` reads of a real one. */
function chartIn({ chartType, series, found }) {
	const list = series.map(({ type, own, id, internal }) => ({
		type,
		coll: 'series',
		userOptions: own === undefined ? {} : { type: own },
		options: { id, isInternal: internal }
	}));
	const get = (id) => {
		const item = found[id];
		if (item === null || item === undefined) return undefined;
		return item.coll === 'series' ? list[item.index] : { coll: item.coll };
	};
	return { options: { chart: { type: chartType } }, series: list, get, update() {}, addSeries() {} };
}

const browser = { skip: browserSkipReason() ?? false };
const outcomes = browser.skip === false ? await runHighchartsUpdates(CASES) : [];

CASES.forEach(({ name, update, oneToOne }, index) =>
	test(`highcharts chart.update: ${name}`, browser, () => {
		const state = outcomes[index];
		assert.equal(state.threw, undefined);
		let view;
		const validator = (input) => {
			view = input;
			return { library: 'highcharts', schemaVersion: 'test', coverage: 'partial', diagnostics: [] };
		};
		const result = checkUpdate(chartIn(state), update, { oneToOne }, { validator });
		const single = !Array.isArray(update.series);
		const ignored = result.diagnostics.filter((d) => d.code === 'CFG_INEFFECTIVE').map((d) => d.path);
		const path = (position) => (single ? '$.series' : `$.series[${String(position)}]`);
		state.reached.forEach((type, position) => {
			if (type === null) assert.ok(ignored.includes(path(position)), `item ${String(position)} is ignored`);
			else assert.equal(view.series[position].type, type, `item ${String(position)} reaches a ${type} series`);
		});
		assert.equal(ignored.length, state.reached.filter((type) => type === null).length);
	})
);

test('the update runner takes plain JSON only', browser, () => {
	assert.throws(() => runHighchartsUpdates([{ create: {}, update: { series: [{ events: { click: () => 0 } }] } }]), {
		message: 'a Highcharts update case must be plain JSON'
	});
});
