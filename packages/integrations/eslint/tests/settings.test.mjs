import assert from 'node:assert/strict';
import test from 'node:test';

import { Linter } from 'eslint';

import plugin from '../dist/index.js';
import { at, finding, javascript } from './helpers.mjs';

/** `settings.chartguard`, shared by both rules (CG-06-03 part 1). */
const { 'valid-config': validConfig, 'config-warnings': configWarnings } = plugin.rules;
const CHART = "import { Chart } from 'chart.js';\n";
const WRONG_MIN = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;

test('libraryVersion: another minor is no confirmed error, another major is not validated', () => {
	javascript.run('valid-config', validConfig, {
		valid: [
			{ code: WRONG_MIN, settings: { chartguard: { libraryVersion: { chartjs: '4.4.1' } } } },
			{ code: WRONG_MIN, settings: { chartguard: { libraryVersion: { chartjs: '3.9.1' } } } }
		],
		invalid: [
			// The version of another library changes nothing for Chart.js.
			{
				code: WRONG_MIN,
				settings: { chartguard: { libraryVersion: { echarts: '5.0.0' } } },
				errors: [
					finding('CFG_TYPE $.options.scales.y.min: Expected number | function, got string.', at(WRONG_MIN, "'x'"))
				]
			}
		]
	});
	const call = at(WRONG_MIN, "{ type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } }");
	javascript.run('config-warnings', configWarnings, {
		valid: [],
		invalid: [
			{
				code: WRONG_MIN,
				settings: { chartguard: { libraryVersion: { chartjs: '3.9.1' } } },
				errors: [
					finding(
						'CFG_UNSUPPORTED_VERSION $: 3.9.1 is not supported: this schema describes chartjs 4.5.1. Not validated.',
						call
					)
				]
			}
		]
	});
});

test('registries: a complete registry rejects what the runtime did not register', () => {
	const code = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [{ type: 'line', data: [1] }] } });`;
	const only = (names) => ({ chartguard: { registries: { 'chartjs.controllers': { names, complete: true } } } });
	javascript.run('valid-config', validConfig, {
		valid: [code, { code, settings: only(['bar', 'line']) }],
		invalid: [{ code, settings: only(['bar']), errors: [{ messageId: 'finding', ...at(code, "'line'") }] }]
	});
});

test('extensions: a plugin schema adds its options, and they are checked', () => {
	const code = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { plugins: { zoom: { enabled: 'yes' } } } });`;
	const zoom = {
		id: 'zoom',
		options: { 'chartjs.plugins': { zoom: { kind: 'object', properties: { enabled: { kind: 'boolean' } } } } }
	};
	javascript.run('valid-config', validConfig, {
		valid: [code],
		invalid: [
			{
				code,
				settings: { chartguard: { extensions: { chartjs: [zoom] } } },
				errors: [finding('CFG_TYPE $.options.plugins.zoom.enabled: Expected boolean, got string.', at(code, "'yes'"))]
			}
		]
	});
});

test("patterns: the project's own wrapper is a use", () => {
	const code = `import { makeChart } from '@acme/charts';\nmakeChart({ type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const patterns = [
		{ id: 'acme.make-chart', library: 'chartjs', module: '@acme/charts', export: 'makeChart', argument: 0 }
	];
	javascript.run('valid-config', validConfig, {
		valid: [code],
		invalid: [
			{
				code,
				settings: { chartguard: { patterns } },
				errors: [finding('CFG_TYPE $.options.scales.y.min: Expected number | function, got string.', at(code, "'x'"))]
			}
		]
	});
});

/** What ESLint says when `settings.chartguard` is given. */
function lintWith(chartguard, code = WRONG_MIN) {
	const linter = new Linter();
	return linter.verify(code, [{ ...plugin.configs.recommended, settings: { chartguard } }], { filename: 'chart.js' });
}

test('settings that cannot be used stop the lint with every problem listed', () => {
	assert.throws(
		() =>
			lintWith({
				libraryVersion: { chartjs: 4, d3: '7.0.0' },
				registries: [],
				extensions: { chartjs: {} },
				patterns: 'mine',
				other: true
			}),
		(error) => {
			for (const problem of [
				'settings.chartguard.libraryVersion.chartjs: must be a version string',
				'settings.chartguard.libraryVersion.d3: unknown library (chartjs, echarts or highcharts)',
				'settings.chartguard.registries: must be an object of registries',
				'settings.chartguard.extensions.chartjs: must be a list of extensions',
				'settings.chartguard.patterns: must be a list of patterns',
				'settings.chartguard.other: unknown key (libraryVersion, registries, extensions, patterns, quality)'
			])
				assert.ok(error.message.includes(problem), `${problem}\n${error.message}`);
			return true;
		}
	);
	assert.throws(() => lintWith([]), /settings\.chartguard: must be an object/u);
});

test('a refused extension or pattern is a setup error naming the setting, never a finding', () => {
	const twice = { id: 'twice', options: { 'chartjs.plugins': { legend: { kind: 'object', properties: {} } } } };
	assert.throws(
		() => lintWith({ extensions: { chartjs: [twice] } }),
		/settings\.chartguard\.extensions\.chartjs: Extensions refused:\ntwice: "legend" is a built-in option/u
	);
	assert.throws(() => lintWith({ patterns: [{ id: 'p' }] }), /settings\.chartguard\.patterns: /u);
	// A setting for a library the file does not use is still checked: it is wrong in every file.
	assert.throws(
		() => lintWith({ extensions: { echarts: [twice] } }, 'const a = 1;'),
		/settings\.chartguard\.extensions\.echarts/u
	);
});
