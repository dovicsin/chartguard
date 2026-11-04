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

test('--ruleset: the rules it names, by id or impact, run; repeatable; it replaces the settings file ruleset (CG-06-02 part 4b)', async (t) => {
	const misleads = JSON.parse((await run([...QUALITY, '--ruleset', 'misleads', '--json'])).out);
	assert.deepEqual(
		misleads.diagnostics.map(({ code }) => code),
		['VIS_BAR_BASELINE']
	);
	assert.ok(misleads.disabled.includes('value-axis-untitled'));
	const union = JSON.parse((await run([...QUALITY, '--ruleset', 'omits', '--ruleset', 'bar-baseline', '--json'])).out);
	assert.deepEqual(
		union.diagnostics.map(({ code }) => code),
		['VIS_BAR_BASELINE', 'VIS_VALUE_AXIS_UNTITLED']
	);
	// The command line replaces the settings file's ruleset; the file's levels still apply.
	const file = settingsFile(t, { ruleset: ['misleads'], rules: { 'value-axis-untitled': 'warning' } });
	const replaced = JSON.parse((await run([...QUALITY, '--settings', file, '--ruleset', 'omits', '--json'])).out);
	assert.deepEqual(
		replaced.diagnostics.map(({ code, severity }) => `${code} ${severity}`),
		['VIS_VALUE_AXIS_UNTITLED warning']
	);
	const fromFile = JSON.parse((await run([...QUALITY, '--settings', file, '--json'])).out);
	assert.deepEqual(
		fromFile.diagnostics.map(({ code }) => code),
		['VIS_BAR_BASELINE']
	);
	// The text names every rule left out.
	assert.match((await run([...QUALITY, '--ruleset', 'misleads'])).out, /OFF .*value-axis-untitled/);
});

test('--ruleset: an unknown entry is an input error naming it; an option of quality only', async () => {
	const unknown = await run([...QUALITY, '--ruleset', 'misleads', '--ruleset', 'VIS_BAR_BASELINE', '--json']);
	assert.equal(unknown.code, 2);
	assert.match(unknown.err, /--ruleset: Invalid quality options:/);
	assert.match(unknown.err, /options\.ruleset\[1\]: is not a rule id or impact \(misleads, excludes, omits, risks, /);
	assert.equal(JSON.parse(unknown.out).error.kind, 'input');
	const validate = [
		'validate',
		'--library',
		'chartjs',
		'--file',
		example('chartjs-quality.json'),
		'--ruleset',
		'misleads'
	];
	const misplaced = await run(validate);
	assert.equal(misplaced.code, 2);
	assert.match(misplaced.err, /--ruleset is not an option of validate/);
});

test('ruleset in the config file: a list for quality; the command line replaces it', async (t) => {
	const root = sourceProject(t, {
		'chart.json': JSON.stringify({
			type: 'bar',
			data: { datasets: [{ label: 'Price', data: [5, 6] }] },
			options: { scales: { y: { min: 4 } } }
		}),
		'chartguard.config.json': JSON.stringify({
			library: 'chartjs',
			files: ['chart.json'],
			quality: { ruleset: ['omits'] }
		})
	});
	const cwd = process.cwd();
	process.chdir(root);
	t.after(() => process.chdir(cwd));
	const configured = JSON.parse((await run(['quality', '--json'])).out);
	assert.ok(configured.disabled.includes('bar-baseline'));
	assert.deepEqual(
		JSON.parse((await run(['quality', '--ruleset', 'misleads', '--json'])).out).diagnostics.map(({ code }) => code),
		['VIS_BAR_BASELINE']
	);
	const malformed = sourceProject(t, {
		'chartguard.config.json': JSON.stringify({ ruleset: 'misleads', validate: { ruleset: ['risks'] } })
	});
	process.chdir(malformed);
	const refused = await run(['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json')]);
	assert.equal(refused.code, 2);
	assert.match(refused.err, /ruleset: must be a list of strings/);
	assert.match(refused.err, /validate\.ruleset: not an option of validate/);
});
