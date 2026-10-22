import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { example, run, sourceProject } from './helpers.mjs';

/** `quality --settings`: rule levels, ignores and the page context (CG-05-05). */
const QUALITY = ['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json')];

/** A settings file with `settings` as its JSON (or text), in a temporary directory. */
function settingsFile(t, settings) {
	const root = sourceProject(t, {
		'settings.json': typeof settings === 'string' ? settings : JSON.stringify(settings)
	});
	return join(root, 'settings.json');
}

test('settings turn a rule off, set a level and ignore a finding at a path; the JSON report keeps what was suppressed', async (t) => {
	const file = settingsFile(t, {
		rules: {
			'value-axis-untitled': 'off',
			'bar-baseline': { level: 'info', ignore: [{ path: '$.options.scales.y', reason: 'A narrow band of prices.' }] }
		}
	});
	const { code, out } = await run([...QUALITY, '--settings', file, '--json']);
	assert.equal(code, 0);
	const report = JSON.parse(out);
	assert.deepEqual(report.diagnostics, []);
	assert.deepEqual(report.disabled, ['value-axis-untitled']);
	assert.deepEqual(
		report.suppressed.map(({ diagnostic, by, reason }) => [
			diagnostic.code,
			diagnostic.severity,
			diagnostic.path,
			by,
			reason
		]),
		[['VIS_BAR_BASELINE', 'info', '$.options.scales.y.min', 'setting', 'A narrow band of prices.']]
	);
	const text = await run([...QUALITY, '--settings', file]);
	assert.match(
		text.out,
		/SUPPRESSED \(setting\) VIS_BAR_BASELINE \$\.options\.scales\.y\.min: A narrow band of prices\./
	);
	assert.match(text.out, /OFF value-axis-untitled/);
	assert.match(text.out, /advisory/);
});

test('the declared page context lets a canvas chart be checked: no description on the page is a finding', async (t) => {
	const file = settingsFile(t, { context: { describesData: false } });
	const report = JSON.parse((await run([...QUALITY, '--settings', file, '--json'])).out);
	assert.deepEqual(
		report.diagnostics.map(({ code, path }) => `${code} ${path}`),
		[
			'VIS_BAR_BASELINE $.options.scales.y.min',
			'VIS_VALUE_AXIS_UNTITLED $.options.scales.y.title.text',
			'VIS_DATA_NOT_DESCRIBED $'
		]
	);
});

test('a malformed or unreadable settings file is an input error (exit 2) listing every problem', async (t) => {
	const invalid = settingsFile(t, { rules: { 'bar-baseline': 'error', nope: 'off' }, context: { background: 'red' } });
	const { code, err } = await run([...QUALITY, '--settings', invalid]);
	assert.equal(code, 2);
	assert.match(err, /settings\.json: Invalid quality options:/);
	assert.match(err, /options\.rules\["bar-baseline"\]: must be one of off, info, warning/);
	assert.match(err, /options\.rules\.nope: is not a rule id/);
	assert.match(err, /options\.context\.background: must be an opaque hex or rgb\(\) colour/);
	assert.doesNotMatch(err, /internal failure/);
	assert.equal((await run([...QUALITY, '--settings', settingsFile(t, '{ not json')])).code, 2);
	assert.equal((await run([...QUALITY, '--settings', join(settingsFile(t, {}), '..', 'missing.json')])).code, 2);
});

test('--settings belongs to quality only', async (t) => {
	const file = settingsFile(t, {});
	const validate = ['validate', '--library', 'chartjs', '--file', example('chartjs-quality.json'), '--settings', file];
	assert.equal((await run(validate)).code, 2);
	assert.equal(
		(await run(['analyze', '--library', 'chartjs', '--file', example('chartjs-source.ts'), '--settings', file])).code,
		2
	);
	assert.equal((await run(['schema', 'build', '--library', 'highcharts', '--settings', file])).code, 2);
});
