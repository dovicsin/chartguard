import assert from 'node:assert/strict';
import test from 'node:test';

import { extractStaticConfigs } from '@chartguard/analysis-typescript';
import { Linter } from 'eslint';

import { renameEdit } from '../dist/edits.js';
import plugin from '../dist/index.js';
import { at, javascript, typescript } from './helpers.mjs';

/**
 * The runtime's own renames as fixes (CG-06-03 part 2): applied only where the key is written in the
 * call that hands the config to the library, so no other code can read the object it edits.
 */
const { 'config-warnings': configWarnings } = plugin.rules;
const ECHARTS = "import * as echarts from 'echarts';\n";
const MESSAGE =
	'CFG_DEPRECATED $.series[0].clockWise: Deprecated: clockWise is deprecated; use clockwise instead. Use "clockwise" instead.';
const call = (series) => `${ECHARTS}echarts.init(el).setOption({ series: [${series}] });`;
const warned = (code, output, place = at(code, 'false')) => ({
	code,
	output,
	errors: [{ message: MESSAGE, ...place }]
});

test('a deprecated key the runtime renames is renamed in place when the call writes it', () => {
	javascript.run('config-warnings', configWarnings, {
		valid: [],
		invalid: [
			warned(
				call("{ type: 'pie', clockWise: false, data: [1] }"),
				call("{ type: 'pie', clockwise: false, data: [1] }")
			),
			// A quoted key keeps its quotes.
			warned(
				call("{ type: 'pie', 'clockWise': false, data: [1] }"),
				call("{ type: 'pie', 'clockwise': false, data: [1] }")
			),
			warned(
				call('{ type: \'pie\', "clockWise": false, data: [1] }'),
				call('{ type: \'pie\', "clockwise": false, data: [1] }')
			)
		]
	});
});

test('no fix where the edit could change something else: a shared object, a shorthand, a duplicate key, a wrapper', () => {
	const viaConst = `${ECHARTS}const pie = { type: 'pie', clockWise: false, data: [1] };\necharts.init(el).setOption({ series: [pie] });`;
	const shorthand = `${ECHARTS}const clockWise = false;\necharts.init(el).setOption({ series: [{ type: 'pie', clockWise, data: [1] }] });`;
	const twice = call("{ type: 'pie', clockWise: true, clockWise: false, data: [1] }");
	// Read completely through the builder, but the literal is the builder's argument, not the use's.
	const builder = `${ECHARTS}const make = (series) => ({ series });\necharts.init(el).setOption(make([{ type: 'pie', clockWise: false, data: [1] }]));`;
	javascript.run('config-warnings', configWarnings, {
		valid: [],
		invalid: [
			warned(viaConst, null),
			// The value of a shorthand was written by the const it names: that is where the finding stands.
			warned(shorthand, null),
			warned(twice, null),
			warned(builder, null)
		]
	});
});

test('TypeScript: a config under `as const` or `satisfies` is not edited; a plain one is', () => {
	const asConst = `${ECHARTS}echarts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] } as const);`;
	typescript.run('config-warnings', configWarnings, {
		valid: [],
		invalid: [
			{ ...warned(asConst, null), filename: 'chart.ts' },
			{
				...warned(
					call("{ type: 'pie', clockWise: false, data: [1] }"),
					call("{ type: 'pie', clockwise: false, data: [1] }")
				),
				filename: 'chart.ts'
			}
		]
	});
});

test('JSX: a key written in the attribute that hands the config to the wrapper is renamed', () => {
	const view = (key) =>
		`import ReactECharts from 'echarts-for-react';\nexport const view = <ReactECharts option={{ series: [{ type: 'pie', ${key}: false, data: [1] }] }} />;`;
	typescript.run('config-warnings', configWarnings, {
		valid: [],
		invalid: [{ ...warned(view('clockWise'), view('clockwise')), filename: 'view.tsx' }]
	});
});

test('a config with a part the analysis cannot read gets no fix: the new key may be set there', () => {
	const spread = call("{ ...defaults, type: 'pie', clockWise: false, data: [1] }");
	javascript.run('config-warnings', configWarnings, { valid: [], invalid: [warned(spread, null)] });
});

test('a rename to a name that is not an identifier is not written', () => {
	const linter = new Linter();
	const code = call("{ type: 'pie', clockWise: false, data: [1] }");
	linter.verify(code, [], { filename: 'chart.js' });
	const [use] = extractStaticConfigs(code, 'chart.js').uses;
	const edit = (to) =>
		renameEdit({ sourceCode: linter.getSourceCode(), fileName: 'chart.js', use }, '$.series[0].clockWise', {
			kind: 'rename-key',
			to
		});
	assert.deepEqual(edit('clockwise')?.text, 'clockwise');
	assert.equal(edit('emphasis.scale'), undefined);
	assert.equal(edit('2d'), undefined);
});
