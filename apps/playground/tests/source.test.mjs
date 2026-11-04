import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';
import { checkText } from '@chartguard/source-checks/text';

import { inspect } from '../dist/model.js';
import { shownJson } from '../dist/shown.js';
import { chartChoices, engineOf, fileNameOf, shownSource, sourceOf, sourceView } from '../dist/source.js';
import { collectExamples } from '../scripts/build.mjs';

/** Source input (CG-06-06 part 3): every example as source gives its JSON claims, the editors' way (E56). */
const ADAPTERS = {
	chartjs: { validate: validateChartjs, analyze: analyzeChartjs },
	echarts: { validate: validateEcharts, analyze: analyzeEcharts },
	highcharts: { validate: validateHighcharts, analyze: analyzeHighcharts }
};
const engine = engineOf(ADAPTERS);
const claims = (items) =>
	items.filter(({ severity }) => severity !== 'info').map(({ severity, code, path }) => `${severity} ${code} ${path}`);
/** As JSON: the analysis builds the values it reads without prototypes. */
const plain = (value) => JSON.parse(JSON.stringify(value));
const offered = (items) =>
	items.filter(({ offer }) => offer !== undefined).map(({ code, path, offer }) => `${code} ${path} ${offer.label}`);

/** One example as source in `language` against its JSON form. */
function compareForms(example, language) {
	const json = JSON.stringify(example.config, null, 2);
	const fromJson = shownJson(json, inspect(json, ADAPTERS[example.library]), example.library);
	const text = sourceOf(example);
	const check = checkText(text, fileNameOf(language), engine);
	const fromSource = shownSource(check, 0);
	const id = `${example.id} (${language})`;
	assert.equal(check.uses.length, 1, id);
	assert.deepEqual(claims(fromSource.validator), claims(fromJson.validator), id);
	assert.deepEqual(
		claims(fromSource.quality),
		claims(fromJson.quality.filter(({ severity }) => severity === 'warning')),
		id
	);
	assert.deepEqual(offered(fromSource.validator), offered(fromJson.validator), id);
	// Every quality fix JSON offers is offered in source too: a value the call writes is replaced, a
	// missing option (`aria.enabled`) inserted into the object the call writes.
	const warnings = fromJson.quality.filter(({ severity }) => severity === 'warning');
	assert.deepEqual(offered(fromSource.quality), offered(warnings), id);
	assert.deepEqual(plain(fromSource.draw), plain(fromJson.draw), id);
	const call = text.indexOf('(', text.lastIndexOf('\n', text.length - 2));
	for (const { range } of [...fromSource.validator, ...fromSource.quality]) assert.ok(range.start > call, id);
}

test('every example as JavaScript and TypeScript: the JSON claims, quality warnings and fixes, inside the call', async () => {
	for (const example of await collectExamples())
		for (const language of ['javascript', 'typescript']) compareForms(example, language);
});

test('a source text the analysis reads in part is checked as incomplete and never drawn', () => {
	const text =
		"import * as echarts from 'echarts';\nconst extra = make();\necharts.init(el).setOption({ ...extra, series: [{ type: 'pie', data: [1] }], tooltip: { trigger: 'x' } });";
	const view = shownSource(checkText(text, 'chart.js', engine), 0);
	assert.deepEqual(claims(view.validator), ['error CFG_ENUM $.tooltip.trigger']);
	assert.deepEqual(view.verdict, { text: '1 error(s)', tone: 'error' });
	assert.equal(view.summary, '1 error(s), 0 warning(s)');
	assert.equal(view.syntax, '');
	assert.deepEqual(view.quality, []);
	assert.equal(view.draw.kind, 'none');
	assert.match(view.draw.reason, /read only in part/u);
	assert.equal(view.schema, '1 chart(s) · echarts · read in part');
});

test('the engine hands each library its own adapter, with the options the checks give', () => {
	const seen = [];
	const spy = (name) => ({
		validate: (config, options) => (seen.push([name, options]), validateChartjs(config, options)),
		analyze: (config) => (seen.push([name, 'review']), analyzeChartjs(config))
	});
	const spied = engineOf({ chartjs: spy('chartjs'), echarts: spy('echarts'), highcharts: spy('highcharts') });
	spied.validate('echarts', {}, { incomplete: true });
	spied.review('highcharts', {});
	assert.deepEqual(seen, [
		['echarts', { incomplete: true }],
		['highcharts', 'review']
	]);
});

test('several charts: each picked by its line and drawn by its own library; none, or unreadable, says why', () => {
	const text =
		"import { Chart } from 'chart.js';\nimport * as echarts from 'echarts';\nnew Chart(c, { type: 'bar', data: { datasets: [] } });\necharts.init(el).setOption({ series: [] });\n";
	const check = checkText(text, 'chart.ts', engine);
	assert.deepEqual(chartChoices(check), [
		{ value: '0', label: 'chartjs, line 3' },
		{ value: '1', label: 'echarts, line 4' }
	]);
	assert.equal(sourceView(check, 1).chart, 1);
	// The text lost its second chart: the first is picked, never a chart that is gone.
	const one = sourceView(checkText(text.split('\n').slice(0, 3).join('\n'), 'chart.ts', engine), 1);
	assert.equal(one.chart, 0);
	assert.equal(one.shown.draw.kind, 'config');
	assert.deepEqual(plain(shownSource(check, 1).draw), { kind: 'config', library: 'echarts', config: { series: [] } });
	const none = shownSource(checkText('const a = 1;', 'chart.js', engine), 0);
	assert.equal(none.draw.kind, 'none');
	assert.match(none.draw.reason, /^No chart config found/u);
	const broken = shownSource(checkText("import { Chart } from 'chart.js';\nnew Chart(c, {", 'chart.js', engine), 0);
	assert.deepEqual(broken.verdict, { text: 'not readable', tone: 'error' });
	assert.match(broken.syntax, /nothing is claimed/u);
	assert.deepEqual([...broken.validator, ...broken.quality], []);
});

test('a rename in source names the new key and keeps its quotes; the counts make the verdict', () => {
	const pie =
		"import * as echarts from 'echarts';\necharts.init(el).setOption({ series: [{ type: 'pie', 'clockWise': false, data: [1] }] });";
	const pieView = shownSource(checkText(pie, 'chart.js', engine), 0);
	const [deprecated] = pieView.validator;
	assert.deepEqual(pieView.verdict, { text: 'no errors', tone: 'ok' });
	assert.equal(pieView.summary, '0 error(s), 1 warning(s)');
	assert.match(deprecated.message, /^Deprecated: clockWise is deprecated/u);
	assert.equal(deprecated.offer.label, 'Rename to clockwise');
	assert.equal(deprecated.offer.edit.text, "'clockwise'");
});

test('a drawing change in source says so and names its effect, at the value the call writes', () => {
	const bars = `import { Chart } from 'chart.js';\nnew Chart(c, ${JSON.stringify({
		type: 'bar',
		data: { labels: ['a', 'b'], datasets: [{ label: 'S', data: [60, 70], backgroundColor: '#1f77b4' }] },
		options: {
			plugins: { title: { display: true, text: 'T' } },
			scales: { y: { title: { display: true, text: 'U' }, min: 50 } }
		}
	})});`;
	const barsView = shownSource(checkText(bars, 'chart.js', engine), 0);
	assert.deepEqual(barsView.fixable, ['VIS_BAR_BASELINE $.options.scales.y.min']);
	const [baseline] = barsView.quality;
	assert.equal(baseline.code, 'VIS_BAR_BASELINE');
	assert.equal(baseline.offer.label, 'Change the chart');
	assert.match(baseline.offer.note, /^Set \$\.options\.scales\.y\.min to 0: /u);
	assert.equal(bars.slice(baseline.offer.edit.start, baseline.offer.edit.end), '50');
});
