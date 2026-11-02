import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '@chartguard/config-highcharts';

import { checkPackagePointers } from '../../../quality/core/tests/pointers.mjs';
import { addSeries, checkUpdate, createChart } from '../dist/index.js';

const quiet = { onResult: () => undefined };
const findings = (result) => result.diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

/** A chart with one untyped series, as `chart.update` and `chart.addSeries` see it; not created through `createChart`. */
function adopted() {
	return {
		options: { chart: { type: 'line' } },
		series: [{ coll: 'series', userOptions: {}, options: {} }],
		get: () => undefined,
		update: () => undefined,
		addSeries: () => ({})
	};
}
/** A validator recording the settings it was given. */
function recording() {
	const seen = [];
	return { seen, validator: (input, settings) => (seen.push(settings), validate(input, settings)) };
}

test('a chart not created through createChart, without a namespace, is checked with a note that the version is unknown', () => {
	const update = checkUpdate(adopted(), { series: [{ lineWidth: 'x' }] });
	const added = addSeries(adopted(), { lineWidth: 'x' }, {}, quiet).result;
	for (const result of [update, added]) {
		const note = result.diagnostics.find((d) => d.code === 'CFG_VERSION_UNKNOWN');
		assert.deepEqual([note?.severity, note?.confidence, note?.path], ['info', 'unknown', '$']);
		assert.match(note.suggestion, /pass `highcharts`/);
	}
});

test('the namespace named in the guard gives the version and the series types, and wins over the remembered one', () => {
	const { seen, validator } = recording();
	const highcharts = { version: '13.0.0', seriesTypes: { line: {}, column: {} } };
	const result = checkUpdate(adopted(), { series: [{ lineWidth: 'x' }] }, {}, { validator, highcharts });
	assert.deepEqual(seen[0], {
		libraryVersion: '13.0.0',
		registries: { 'highcharts.series': { names: ['column', 'line'], complete: true } },
		incomplete: true
	});
	assert.ok(findings(result).includes('warning CFG_VERSION_MISMATCH $'));
	assert.equal(
		result.diagnostics.some((d) => d.code === 'CFG_VERSION_UNKNOWN'),
		false
	);
	// A chart created through createChart remembers its Highcharts; a namespace the caller names wins.
	const chart = adopted();
	createChart({ version: '13.1.1', chart: () => chart }, 'box', {}, quiet);
	checkUpdate(chart, {}, {}, { validator });
	addSeries(chart, {}, {}, { ...quiet, validator, highcharts });
	assert.deepEqual(
		seen.slice(1).map(({ libraryVersion }) => libraryVersion),
		['13.1.1', '13.0.0']
	);
	assert.equal(
		checkUpdate(chart, {}, {}, { validator }).diagnostics.some((d) => d.code === 'CFG_VERSION_UNKNOWN'),
		false
	);
	// A version the caller names needs no namespace: it is known.
	const named = checkUpdate(adopted(), {}, {}, { options: { libraryVersion: '13.1.1' } });
	assert.equal(
		named.diagnostics.some((d) => d.code === 'CFG_VERSION_UNKNOWN'),
		false
	);
});

test('every runtime pointer the wrapper rests on is a literal that still holds in the pinned highcharts (E37)', () =>
	assert.equal(checkPackagePointers(import.meta.url), 10));
