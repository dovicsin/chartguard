import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from '../dist/index.js';
import { at, javascript, typescript } from './helpers.mjs';

/**
 * Quality findings (CG-06-03 part 2): advisory, only for configs read completely, never fixed without
 * the user (a suggestion, not a fix).
 */
const { 'chart-quality': chartQuality } = plugin.rules;
const CHART = "import { Chart } from 'chart.js';\n";
const BASELINE =
	'VIS_BAR_BASELINE $.options.scales.y.min: Bars are drawn on a value axis that starts above zero, so their lengths are not proportional to their values; verify that the comparison is not misleading.';
const EFFECT = 'The bars grow from zero again, so their lengths are proportional to their values.';
const bars = (y) =>
	`${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'Sales', data: [10] }] }, options: { scales: { y: { ${y}, title: { display: true, text: 'Count' } } } } });`;

test('chart-quality: a warning at the value it is about, with its verified edit as a suggestion', () => {
	const code = bars('min: 5');
	javascript.run('chart-quality', chartQuality, {
		valid: [
			bars('min: 0'),
			// Info findings are no lint claim unless the settings raise them.
			`${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'Sales', data: [10] }] } });`
		],
		invalid: [
			{
				code,
				output: null,
				errors: [
					{
						message: BASELINE,
						...at(code, '5'),
						suggestions: [
							{
								desc: `Set $.options.scales.y.min to 0: ${EFFECT}`,
								output: bars('min: 0')
							}
						]
					}
				]
			}
		]
	});
});

test('chart-quality: a string value is written as a JSON string', () => {
	const code = bars("type: 'logarithmic'");
	javascript.run('chart-quality', chartQuality, {
		valid: [],
		invalid: [
			{
				code,
				errors: [
					{
						message:
							'VIS_BAR_LOG_SCALE $.options.scales.y.type: Bars are drawn on a logarithmic axis: their lengths do not encode their values; consider points or lines, or a linear axis.',
						...at(code, "'logarithmic'"),
						suggestions: [
							{
								desc: 'Set $.options.scales.y.type to "linear": The value scale is linear, so bar lengths encode the values; very small values may become hard to see.',
								output: bars('type: "linear"')
							}
						]
					}
				]
			}
		]
	});
});

test('chart-quality: a react-chartjs-2 element offers the edit in the attribute that writes it', () => {
	const view = (min) =>
		`import { Bar } from 'react-chartjs-2';\nexport const view = <Bar data={{ labels: ['a'], datasets: [{ label: 'Sales', data: [10] }] }} options={{ scales: { y: { min: ${min}, title: { display: true, text: 'Count' } } } }} />;`;
	typescript.run('chart-quality', chartQuality, {
		valid: [],
		invalid: [
			{
				code: view(5),
				filename: 'view.tsx',
				errors: [
					{
						message: BASELINE,
						...at(view(5), '5'),
						suggestions: [{ desc: `Set $.options.scales.y.min to 0: ${EFFECT}`, output: view(0) }]
					}
				]
			}
		]
	});
});

test('chart-quality: nothing about a config the analysis did not read completely', () => {
	javascript.run('chart-quality', chartQuality, {
		valid: [
			`${CHART}new Chart(ctx, { ...shared, type: 'bar', data: { labels: ['a'], datasets: [{ data: [10] }] }, options: { scales: { y: { min: 5 } } } });`
		],
		invalid: []
	});
});

test('chart-quality: no suggestion where the edit could change another reader of the value', () => {
	const code = `${CHART}const y = { min: 5, title: { display: true, text: 'Count' } };\nnew Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'Sales', data: [10] }] }, options: { scales: { y } } });`;
	javascript.run('chart-quality', chartQuality, {
		valid: [],
		invalid: [{ code, errors: [{ message: BASELINE, ...at(code, '5'), suggestions: [] }] }]
	});
});

test('settings.chartguard.quality: rule levels, ignores and context as quality --settings takes them', () => {
	const code = bars('min: 5');
	javascript.run('chart-quality', chartQuality, {
		valid: [
			{ code, settings: { chartguard: { quality: { rules: { 'bar-baseline': 'off' } } } } },
			{ code, settings: { chartguard: { quality: { ruleset: ['omits'] } } } }
		],
		invalid: [
			{
				code: `${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'Sales', data: [10] }] } });`,
				settings: { chartguard: { quality: { rules: { 'value-axis-untitled': 'warning' } } } },
				errors: 1
			}
		]
	});
	const lint = (quality) =>
		new Linter().verify(code, [{ ...plugin.configs.recommended, settings: { chartguard: { quality } } }], {
			filename: 'chart.js'
		});
	assert.throws(() => lint({ rules: { 'bar-baseline': 'loud' } }), /settings\.chartguard\.quality: .*bar-baseline/u);
	assert.throws(() => lint([]), /settings\.chartguard\.quality: /u);
});

test('recommended: quality findings warn and never fail the lint', () => {
	const messages = new Linter().verify(bars('min: 5'), [plugin.configs.recommended], { filename: 'chart.js' });
	assert.deepEqual(
		messages.map(({ ruleId, severity }) => [ruleId, severity]),
		[['chartguard/chart-quality', 1]]
	);
});
