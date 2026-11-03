import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';

import { SourceChecker } from '../dist/index.js';
import { checkText } from '../dist/text.js';

/** One text read alone, without Node (CG-06-06 part 3): the findings `SourceChecker` gives (E56). */
const VALIDATE = { chartjs: validateChartjs, echarts: validateEcharts, highcharts: validateHighcharts };
const REVIEW = { chartjs: analyzeChartjs, echarts: analyzeEcharts, highcharts: analyzeHighcharts };
const calls = [];
const engine = {
	validate: (library, config, options) => {
		calls.push({ library, options });
		return VALIDATE[library](config, options);
	},
	review: (library, config) => REVIEW[library](config)
};
const CHART = "import { Chart } from 'chart.js';\n";
const ECHARTS = "import * as echarts from 'echarts';\n";
const TEXTS = [
	`${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`,
	`${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'S', data: [10] }] }, options: { responsiv: true, scales: { y: { min: 5, title: { display: true, text: 'Count' } } } } });`,
	`${ECHARTS}echarts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });`,
	`${ECHARTS}const extra = make();\necharts.init(el).setOption({ ...extra, series: [{ type: 'pie', data: [1] }], tooltip: { trigger: 'x' } });`
];

test('a text read alone gives exactly the findings SourceChecker gives for that file', () => {
	for (const text of TEXTS) {
		const fileName = `${process.cwd()}/chart.js`;
		const alone = checkText(text, fileName, engine);
		assert.equal(alone.readable, true);
		assert.deepEqual(alone.findings, new SourceChecker(undefined, 'chartguard').check(text, fileName, process.cwd()));
	}
});

test('findings carry the code and path of the claim, at the range that wrote it', () => {
	const text = TEXTS[0];
	const { uses, findings } = checkText(text, 'chart.ts', engine);
	assert.equal(uses.length, 1);
	const [finding] = findings;
	assert.equal(finding.kind, 'valid-config');
	assert.equal(finding.code, 'CFG_TYPE');
	assert.equal(finding.path, '$.options.scales.y.min');
	assert.equal(text.slice(finding.start, finding.end), "'x'");
});

test('a partial read is validated as incomplete and never reviewed; a text TypeScript cannot read claims nothing', () => {
	calls.length = 0;
	const partial = checkText(TEXTS[3], 'chart.js', engine);
	assert.deepEqual(calls, [{ library: 'echarts', options: { incomplete: true } }]);
	assert.equal(partial.uses[0].complete, false);
	assert.deepEqual(
		partial.findings.map(({ kind, code }) => [kind, code]),
		[['valid-config', 'CFG_ENUM']]
	);
	const broken = checkText(`${CHART}new Chart(ctx, { type: 'bar', options: { responsive: 'x' } ;`, 'chart.js', engine);
	assert.equal(broken.readable, false);
	assert.deepEqual(broken.findings, []);
});

test('each library in one text is checked by its own validator, the edits offered as in the editors', () => {
	const text = `${CHART}${ECHARTS}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { responsive: 'x' } });\necharts.init(el).setOption({ series: [{ type: 'pie', clockWise: false, data: [1] }] });`;
	const { uses, findings } = checkText(text, 'chart.js', engine);
	assert.deepEqual(
		uses.map(({ library }) => library),
		['chartjs', 'echarts']
	);
	const deprecated = findings.find(({ code }) => code === 'CFG_DEPRECATED');
	assert.deepEqual(deprecated.fix, {
		start: text.indexOf('clockWise'),
		end: text.indexOf('clockWise') + 'clockWise'.length,
		text: 'clockwise'
	});
	assert.ok(findings.some(({ code, path }) => code === 'CFG_TYPE' && path === '$.options.responsive'));
});
