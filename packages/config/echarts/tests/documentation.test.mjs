import assert from 'node:assert/strict';
import test from 'node:test';

import { validate } from '../dist/index.js';
import docs from '../src/generated/echarts-docs.json' with { type: 'json' };

const PAGE = 'https://echarts.apache.org/en/option.html';
const deprecations = (config) =>
	validate(config)
		.diagnostics.filter((d) => d.code === 'CFG_DEPRECATED')
		.map((d) => [d.path, d.documentationUrl]);
const axes = { xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' } };

test('a deprecation links to where its migration is documented: what replaces it, at the same place', () => {
	assert.deepEqual(deprecations({ series: [{ type: 'pie', data: [1], label: { margin: 8 }, clockWise: false }] }), [
		['$.series[0].label.margin', `${PAGE}#series-pie.label.edgeDistance`],
		['$.series[0].clockWise', `${PAGE}#series-pie.clockwise`]
	]);
	assert.deepEqual(deprecations({ ...axes, series: { type: 'line', data: [1], clipOverflow: false } }), [
		['$.series.clipOverflow', `${PAGE}#series-line.clip`]
	]);
	// A replacement named from the option root.
	assert.deepEqual(deprecations({ ...axes, grid: { containLabel: true }, series: [] }), [
		['$.grid.containLabel', `${PAGE}#grid.outerBounds`]
	]);
});

test('no link when the documentation has no such anchor, or the series type cannot be read', () => {
	const getter = Object.defineProperty({ data: [1], clockWise: false }, 'type', { enumerable: true, get: () => 'pie' });
	const [finding] = validate({ series: [getter] }).diagnostics.filter((d) => d.code === 'CFG_DEPRECATED');
	assert.equal(finding?.documentationUrl, undefined);
	assert.deepEqual(deprecations({ ...axes, series: [{ type: 'bar', data: [1], itemStyle: { barBorderRadius: 4 } }] }), [
		['$.series[0].itemStyle.barBorderRadius', `${PAGE}#series-bar.itemStyle.borderRadius`]
	]);
});

test('the pinned documentation data names its source, license and digest', () => {
	assert.deepEqual(
		[docs.source, docs.page, docs.license],
		['https://echarts.apache.org/en/documents/option-parts/option-outline.json', PAGE, 'Apache-2.0']
	);
	assert.match(docs.sha256, /^[0-9a-f]{64}$/);
	assert.match(docs.retrieved, /^\d{4}-\d{2}-\d{2}$/);
	assert.deepEqual(docs.anchors, [...docs.anchors].sort());
});
