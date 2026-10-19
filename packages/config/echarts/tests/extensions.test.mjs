import assert from 'node:assert/strict';
import test from 'node:test';

import { s } from '@chartguard/config-core';

import { ExtensionError, validate, withExtensions } from '../dist/index.js';

/** The Baidu map extension's `bmap` component and echarts-wordcloud's series, as a user would describe them. */
const BMAP = {
	id: 'bmap',
	options: { 'echarts.options': { bmap: s.object({ zoom: s.number(), roam: s.boolean() }) } }
};
const WORDCLOUD = {
	id: 'wordcloud',
	variants: { echarts: { 'series.wordCloud': s.object({ gridSize: s.number(), data: s.array(s.any()) }) } }
};
const findings = (validator, config, options) =>
	validator(config, options).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);

test('an extension component is checked at the option root, an extension series by its type', () => {
	const validator = withExtensions([BMAP, WORDCLOUD]);
	const config = { bmap: { zoom: 'near' }, series: [{ type: 'wordCloud', gridSize: 'big', data: [] }] };
	assert.deepEqual(findings(validator, config), ['error CFG_TYPE $.bmap.zoom', 'error CFG_TYPE $.series[0].gridSize']);
	// A single series object (`series: {…}`) selects the same variant.
	assert.deepEqual(findings(validator, { series: { type: 'wordCloud', gridSize: 'big' } }), [
		'error CFG_TYPE $.series.gridSize'
	]);
	assert.deepEqual(findings(validate, config), ['warning CFG_UNKNOWN_VARIANT $.series[0].type']);
});

test('a tree-shaken build must register the extension series too', () => {
	const validator = withExtensions([WORDCLOUD]);
	const registries = (names) => ({ registries: { echarts: { names, complete: true } } });
	const config = { series: [{ type: 'wordCloud', data: [] }] };
	assert.deepEqual(findings(validator, config, registries(['series.line'])), [
		'error CFG_UNREGISTERED $.series[0].type'
	]);
	assert.deepEqual(findings(validator, config, registries(['series.wordCloud'])), []);
});

test('built-in components and series cannot be replaced', () => {
	assert.throws(
		() =>
			withExtensions([
				{ id: 'x', options: { 'echarts.options': { title: s.object({}) } } },
				{ id: 'y', variants: { echarts: { 'series.bar': s.object({}) } } }
			]),
		(error) => {
			assert.ok(error instanceof ExtensionError);
			assert.deepEqual(error.problems, [
				'x: "title" is a built-in option of echarts.options and cannot be replaced',
				'y: "series.bar" is a built-in variant of echarts and cannot be replaced'
			]);
			return true;
		}
	);
});
