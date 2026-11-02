import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Linter } from 'eslint';

import { analysisOf } from '../dist/analysis.js';
import plugin from '../dist/index.js';

/** The plugin object, its recommended flat config and how the rules meet ESLint (CG-06-03 part 1). */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('the plugin names itself as its package does and offers exactly its three rules', () => {
	assert.deepEqual(plugin.meta, { name: manifest.name, version: manifest.version });
	assert.deepEqual(Object.keys(plugin.rules).sort(), ['chart-quality', 'config-warnings', 'valid-config']);
	for (const rule of Object.values(plugin.rules)) {
		assert.equal(typeof rule.meta.docs.description, 'string');
		assert.deepEqual(rule.meta.schema, []);
	}
	const offers = Object.fromEntries(
		Object.entries(plugin.rules).map(([name, { meta }]) => [name, [meta.type, meta.fixable, meta.hasSuggestions]])
	);
	// Only the runtime's own renames are fixes; a quality edit changes the drawing and is only offered.
	assert.deepEqual(offers, {
		'valid-config': ['problem', undefined, undefined],
		'config-warnings': ['problem', 'code', undefined],
		'chart-quality': ['suggestion', undefined, true]
	});
});

test('recommended: errors fail, warnings warn, through ESLint itself', () => {
	const { recommended } = plugin.configs;
	assert.equal(recommended.plugins.chartguard, plugin);
	const messages = new Linter().verify(
		"import { Chart } from 'chart.js';\nnew Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { responsiv: true, scales: { y: { min: 'x' } } } });",
		[recommended],
		{ filename: 'chart.js' }
	);
	assert.deepEqual(
		messages.map(({ ruleId, severity }) => [ruleId, severity]),
		[
			['chartguard/config-warnings', 1],
			['chartguard/valid-config', 2]
		]
	);
});

test('a file in another language is not read; a file TypeScript cannot parse yields nothing', () => {
	for (const rule of Object.values(plugin.rules)) {
		const context = { sourceCode: { ast: { type: 'Document' }, text: '{}' }, settings: {}, filename: 'a.json' };
		assert.deepEqual(rule.create(context), {});
	}
	// Sloppy-mode JavaScript ESLint parses as a script; TypeScript reports `08` as a syntax error.
	const script = { ...plugin.configs.recommended, languageOptions: { sourceType: 'script' } };
	const code =
		"const { Chart } = require('chart.js');\nnew Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });\n";
	const lint = (text) =>
		new Linter().verify(text, [script], { filename: 'chart.js' }).map(({ ruleId, fatal }) => [ruleId, fatal ?? false]);
	assert.deepEqual(lint(code), [['chartguard/valid-config', false]]);
	assert.deepEqual(lint(`${code}a = 08;`), []);
	// Values read from such a tree would still be checked (ECharts: a confirmed type error): nothing is.
	const echarts =
		"const echarts = require('echarts');\necharts.init(el).setOption({ title: { text: 5 }, series: [{ type: 'pie', data: [1] }] });\n";
	assert.ok(lint(echarts).some(([ruleId]) => ruleId === 'chartguard/valid-config'));
	assert.deepEqual(lint(`${echarts}a = 08;`), []);
});

test('both rules read one analysis of a file: one per text and settings, held only as long as ESLint holds the file', () => {
	const linter = new Linter();
	const code = "import { Chart } from 'chart.js';\nnew Chart(ctx, { type: 'bar', data: { datasets: [] } });";
	linter.verify(code, [plugin.configs.recommended], { filename: 'chart.js' });
	const sourceCode = linter.getSourceCode();
	const settings = {};
	const first = analysisOf(sourceCode, settings, 'chart.js', process.cwd());
	assert.equal(analysisOf(sourceCode, settings, 'chart.js', process.cwd()), first);
	assert.equal(first.length, 0);
	// Other settings are another analysis (a pattern may find other uses).
	assert.notEqual(analysisOf(sourceCode, { chartguard: {} }, 'chart.js', process.cwd()), first);
	linter.verify(`${code}\n`, [plugin.configs.recommended], { filename: 'chart.js' });
	assert.notEqual(analysisOf(linter.getSourceCode(), settings, 'chart.js', process.cwd()), first);
});
