import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '@chartguard/analysis-typescript';
import { applyFix } from '@chartguard/core';
import ts from 'typescript';

import { renameEdit } from '../dist/edits.js';
import { SettingsError, SourceChecker } from '../dist/index.js';

/**
 * The checks editors and linters share (CG-06-04): findings as offsets into the checked text, so each
 * caller counts lines its own way; edits as offsets too. The ESLint plugin's suites cover the rules.
 */
const CHART = "import { Chart } from 'chart.js';\n";
const ECHARTS = "import * as echarts from 'echarts';\n";
const check = (text, settings, fileName = 'chart.js') =>
	new SourceChecker(settings, 'chartguard').check(text, fileName, process.cwd());
const apply = (text, { start, end, text: replacement }) => `${text.slice(0, start)}${replacement}${text.slice(end)}`;

test('a finding is the offsets of the value it is about, whatever line breaks precede it', () => {
	for (const breaks of ['\n', '\r\n', '\r', '\u2028', '\u2029']) {
		const text = `${CHART}/* a${breaks}b */${breaks}new Chart(ctx, {${breaks}type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
		const [finding] = check(text);
		assert.deepEqual(
			[finding.kind, text.slice(finding.start, finding.end), finding.message.split(':')[0]],
			['valid-config', "'x'", 'CFG_TYPE $.options.scales.y.min'],
			JSON.stringify(breaks)
		);
	}
});

test('edits are offsets too: a fix and a suggestion each give the text the engine verified', () => {
	const pie = `${ECHARTS}echarts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });`;
	const [deprecated] = check(pie);
	assert.equal(apply(pie, deprecated.fix), pie.replace('clockWise', 'clockwise'));
	const bars = `${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'S', data: [10] }] }, options: { scales: { y: { min: 5, title: { display: true, text: 'Count' } } } } });`;
	const [baseline] = check(bars);
	assert.equal(baseline.kind, 'chart-quality');
	assert.equal(apply(bars, baseline.suggestion.edit), bars.replace('min: 5', 'min: 0'));
});

test('TypeScript keeps parentheses: a config written in parentheses is not edited', () => {
	const pie = `${ECHARTS}echarts.init(el).setOption(({ series: [{ type: 'pie', clockWise: false, data: [1] }] }));`;
	const [deprecated] = check(pie);
	assert.equal(deprecated.message.split(':')[0], 'CFG_DEPRECATED $.series[0].clockWise');
	assert.equal(deprecated.fix, undefined);
});

test('a rename to a name that is not an identifier is not written', () => {
	const text = `${ECHARTS}echarts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });`;
	const file = ts.createSourceFile('chart.js', text, ts.ScriptTarget.Latest, true);
	const [use] = extractStaticConfigs(text, 'chart.js').uses;
	const edit = (to) =>
		renameEdit({ file, inFile: (range) => range.file === 'chart.js', use }, '$.series[0].clockWise', {
			kind: 'rename-key',
			to
		});
	assert.equal(edit('clockwise')?.text, 'clockwise');
	assert.equal(edit('emphasis.scale'), undefined);
	assert.equal(edit('2d'), undefined);
});

test('settings are named where the caller reads them, in every problem', () => {
	assert.throws(
		() => new SourceChecker({ other: 1, libraryVersion: { d3: '1.0.0' } }, 'chartguard'),
		(error) => {
			assert.ok(error instanceof SettingsError);
			assert.equal(error.prefix, 'chartguard');
			assert.deepEqual(error.problems, [
				'chartguard.other: unknown key (libraryVersion, registries, extensions, patterns, quality, project)',
				'chartguard.libraryVersion.d3: unknown library (chartjs, echarts or highcharts)'
			]);
			assert.match(error.message, /^ChartGuard: chartguard cannot be used:\n {2}chartguard\.other/u);
			return true;
		}
	);
	// No settings at all are no error.
	assert.deepEqual(new SourceChecker(undefined, 'chartguard').check(CHART, 'a.js', process.cwd()), []);
});

test('a key whose value is an object is renamed: the edit finds the property through its whole value', () => {
	const text = `${ECHARTS}echarts.init(el).setOption({ series: [{ type: 'sunburst', downplay: { itemStyle: { opacity: 0.5 } }, data: [] }] });`;
	const [deprecated] = check(text).filter(({ kind }) => kind === 'config-warnings');
	assert.equal(apply(text, deprecated.fix), text.replace('downplay', 'blur'));
});

test('info findings are no claim: a config the analysis read in part reports nothing it cannot confirm', () => {
	const text = `${CHART}import { data } from './d';\nnew Chart(ctx, { type: 'bar', data, options: { scales: { y: { min: 'x' } } } });`;
	assert.deepEqual(check(text), []);
});

/** The config the edited text hands to the library, read again by the analysis. */
const configAfter = (text, edit) => extractStaticConfigs(apply(text, edit), 'chart.js').uses[0]?.value;

/** A value as JSON data, prototypes aside. */
const asData = (value) => JSON.parse(JSON.stringify(value));

/** The suggestion setting `path` in `text`, if one is offered. */
const insertionAt = (text, path) =>
	check(text).find((finding) => finding.path === path && finding.suggestion !== undefined)?.suggestion;

test('a suggestion that sets an unset option inserts it where the call writes the object, meaning what applyFix means', () => {
	const pie = (option) => `${ECHARTS}echarts.init(el).setOption(${option});`;
	const cases = [
		// The parent is missing: the option is inserted into the root object with its parent.
		["{ series: [{ type: 'pie', data: [1] }] }", "{ series: [{ type: 'pie', data: [1] }], aria: { enabled: true } }"],
		// The parent is there: the option is inserted into it.
		[
			"{ series: [{ type: 'pie', data: [1] }], aria: {} }",
			"{ series: [{ type: 'pie', data: [1] }], aria: { enabled: true } }"
		],
		[
			"{ aria: { label: { enabled: true } }, series: [{ type: 'pie', data: [1] }] }",
			"{ aria: { label: { enabled: true }, enabled: true }, series: [{ type: 'pie', data: [1] }] }"
		],
		// One member per line: the new one takes the last one's indentation; a trailing comma stays.
		[
			"{\n\tseries: [{ type: 'pie', data: [1] }],\n}",
			"{\n\tseries: [{ type: 'pie', data: [1] }],\n\taria: { enabled: true },\n}"
		]
	];
	for (const [option, expected] of cases) {
		const text = pie(option);
		const suggestion = insertionAt(text, '$.aria.enabled');
		assert.ok(suggestion !== undefined, option);
		assert.equal(apply(text, suggestion.edit), pie(expected), option);
		const before = extractStaticConfigs(text, 'chart.js').uses[0].value;
		const fix = { kind: 'set-option', path: '$.aria.enabled', value: true, effect: '' };
		// As data: the analysis reads objects without a prototype, applyFix creates plain ones.
		assert.deepEqual(asData(configAfter(text, suggestion.edit)), asData(applyFix(before, fix)), option);
	}
});

test('an unset option is not inserted where another part of the code holds the object it goes into', () => {
	const series = "series: [{ type: 'pie', data: [1] }]";
	for (const text of [
		// The parent comes from a spread: inserting a new aria would replace it.
		`${ECHARTS}const base = { aria: { label: { enabled: true } } };\necharts.init(el).setOption({ ...base, ${series} });`,
		// The parent is another variable's object.
		`${ECHARTS}const aria = {};\necharts.init(el).setOption({ aria, ${series} });`,
		// The whole option is another variable's object.
		`${ECHARTS}const option = { ${series} };\necharts.init(el).setOption(option);`
	]) {
		const finding = check(text).find(({ path }) => path === '$.aria.enabled');
		assert.ok(finding !== undefined, text);
		assert.equal(finding.suggestion, undefined, text);
	}
});
