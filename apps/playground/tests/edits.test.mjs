import assert from 'node:assert/strict';
import test from 'node:test';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';

import { applyEdit, fixEdit, offerOf } from '../dist/edits.js';
import { inspect } from '../dist/model.js';
import { collectExamples } from '../scripts/build.mjs';

/** Quick fixes as text edits (CG-06-06 part 2): each verified against `applyFix`, the user's formatting kept. */
const ADAPTERS = {
	chartjs: { validate: validateChartjs, analyze: analyzeChartjs },
	echarts: { validate: validateEcharts, analyze: analyzeEcharts },
	highcharts: { validate: validateHighcharts, analyze: analyzeHighcharts }
};

const checked = (text, library = 'echarts') => {
	const inspection = inspect(text, ADAPTERS[library]);
	assert.equal(inspection.kind, 'checked');
	return inspection;
};
const findings = ({ validation, quality }) => [...validation.diagnostics, ...quality.diagnostics];
const rename = (path, to) => ({
	code: 'CFG_DEPRECATED',
	severity: 'warning',
	message: '',
	confidence: 'certain',
	path,
	fix: { kind: 'rename-key', to }
});
const setOption = (path, value, from) => ({
	code: 'VIS_X',
	severity: 'info',
	message: '',
	confidence: 'certain',
	path,
	fix: { kind: 'set-option', path, value, effect: 'e', ...(from === undefined ? {} : { from }) }
});
const edited = (text, diagnostic) => {
	const parsed = checked(text);
	const edit = fixEdit(parsed, diagnostic);
	return edit === undefined ? undefined : applyEdit(text, edit);
};

test('a rename replaces the key token only, escapes and formatting kept', () => {
	const text = '{\n  "series": [ { "type": "pie",   "clockWise" : false, "data": [] } ]\n}';
	assert.equal(
		edited(text, rename('$.series[0].clockWise', 'clockwise')),
		'{\n  "series": [ { "type": "pie",   "clockwise" : false, "data": [] } ]\n}'
	);
	assert.equal(edited('{"a\\u0062": 1}', rename('$.ab', 'c')), '{"c": 1}');
});

test('a value is replaced in place; a missing key is inserted on the indentation of the last entry', () => {
	assert.equal(edited('{"a": {"b": 50 }}', setOption('$.a.b', 0, 50)), '{"a": {"b": 0 }}');
	assert.equal(
		edited('{\n  "title": {"text": "T"},\n    "series": []\n}', setOption('$.aria.enabled', true)),
		'{\n  "title": {"text": "T"},\n    "series": [],\n    "aria": {"enabled":true}\n}'
	);
	assert.equal(edited('{"aria": {}}', setOption('$.aria.enabled', true)), '{"aria": {"enabled": true}}');
	// The last key shares its line with another entry: the new one follows on that line.
	assert.equal(edited('{\n  "a": 1, "b": 2\n}', setOption('$.c', 3)), '{\n  "a": 1, "b": 2, "c": 3\n}');
	assert.equal(edited('{"a": {}}', setOption('$.a.b[0]', 1)), '{"a": {"b": {"0":1}}}');
	assert.equal(
		edited('{"aria": { "x": 1 }}', setOption('$.aria.enabled', true)),
		'{"aria": { "x": 1, "enabled": true }}'
	);
	assert.equal(edited('{"a": 1}', setOption('$.__proto__.b', 1)), '{"a": 1, "__proto__": {"b":1}}');
});

test('no edit when the fix no longer holds or the edited text would not mean what applyFix means', () => {
	// The option changed since the finding (`from`), the renamed key is gone, its new name is taken.
	assert.equal(edited('{"a": {"b": 40}}', setOption('$.a.b', 0, 50)), undefined);
	assert.equal(edited('{"a": {"b": 40}}', setOption('$.a.b', 0)), undefined);
	assert.equal(edited('{"a": 1}', rename('$.b', 'c')), undefined);
	assert.equal(edited('{"a": 1, "c": 2}', rename('$.a', 'c')), undefined);
	// A duplicate key: renaming the last `a` would leave the first one in the text.
	assert.equal(edited('{"a": 1, "a": 2}', rename('$.a', 'b')), undefined);
	// A primitive or a missing array element on the way.
	assert.equal(edited('{"a": 1}', setOption('$.a.b', 0)), undefined);
	assert.equal(edited('{"a": []}', setOption('$.a[0].b', 0)), undefined);
	assert.equal(edited('{"a": [{}]}', setOption('$.a[0].b', 0)), '{"a": [{"b": 0}]}');
	assert.equal(fixEdit(checked('{}'), { ...rename('$.a', 'b'), fix: undefined }), undefined);
	assert.equal(edited('{"a": 1}', rename('$', 'b')), undefined);
});

test('a rename is offered as a rename; a drawing change says so and names its effect', () => {
	const parsed = checked('{"series": [{"type": "pie", "clockWise": false, "data": [1]}]}');
	const [deprecated] = parsed.validation.diagnostics;
	assert.deepEqual(offerOf(parsed, deprecated), {
		label: 'Rename to clockwise',
		edit: { start: 28, end: 39, text: '"clockwise"' }
	});
	const aria = parsed.quality.diagnostics.find(({ code }) => code === 'VIS_DATA_NOT_DESCRIBED');
	assert.equal(offerOf(parsed, aria).label, 'Change the chart');
	assert.match(offerOf(parsed, aria).note, /^ECharts describes the chart .* Sets \$\.aria\.enabled to true\.$/u);
	assert.equal(offerOf(parsed, { ...deprecated, fix: undefined }), undefined);
	assert.equal(offerOf(parsed, rename('$.nothing', 'x')), undefined);
});

test('a drawing change from a Chart.js quality finding, at the value the finding holds', () => {
	const text = JSON.stringify(
		{
			type: 'bar',
			data: { labels: ['a', 'b'], datasets: [{ label: 'S', data: [60, 70], backgroundColor: '#1f77b4' }] },
			options: {
				plugins: { title: { display: true, text: 'T' } },
				scales: { y: { title: { display: true, text: 'U' }, min: 50 } }
			}
		},
		null,
		2
	);
	const parsed = checked(text, 'chartjs');
	const baseline = parsed.quality.diagnostics.find(({ code }) => code === 'VIS_BAR_BASELINE');
	const after = checked(applyEdit(text, fixEdit(parsed, baseline)), 'chartjs');
	assert.equal(after.config.options.scales.y.min, 0);
	assert.equal(
		findings(after).some(({ code }) => code === 'VIS_BAR_BASELINE'),
		false
	);
});

test('every fix any example offers edits its text into what applyFix gives, and removes its finding', async () => {
	let offered = 0;
	for (const example of await collectExamples()) {
		const text = JSON.stringify(example.config, null, 2);
		const parsed = checked(text, example.library);
		for (const diagnostic of findings(parsed).filter(({ fix }) => fix !== undefined)) {
			const edit = fixEdit(parsed, diagnostic);
			assert.notEqual(edit, undefined, `${example.id} ${diagnostic.code} ${diagnostic.path}`);
			const after = findings(checked(applyEdit(text, edit), example.library));
			const same = (other) => other.code === diagnostic.code && other.path === diagnostic.path;
			assert.equal(after.some(same), false, `${example.id} ${diagnostic.code} ${diagnostic.path}`);
			offered++;
		}
	}
	assert.ok(offered >= 80, String(offered));
});
