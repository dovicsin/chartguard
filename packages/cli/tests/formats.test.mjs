import assert from 'node:assert/strict';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { example, run, sourceProject } from './helpers.mjs';

/**
 * Output formats and the failure threshold (CG-06-02 part 1): `--format text|json|sarif` and
 * `--fail-on error|warning|never`. A SARIF log is checked against the 2.1.0 fields GitHub code
 * scanning reads.
 */
const uriOf = (file) => relative(process.cwd(), file).split(sep).join('/');

function assertSarif(log) {
	assert.equal(log.version, '2.1.0');
	assert.match(log.$schema, /sarif-schema-2\.1\.0\.json$/u);
	assert.equal(log.runs.length, 1);
	const [{ tool, results }] = log.runs;
	assert.equal(tool.driver.name, 'ChartGuard');
	assert.match(tool.driver.version, /^\d+\.\d+\.\d+/u);
	const ids = new Set(tool.driver.rules.map(({ id }) => id));
	for (const result of results) {
		assert.ok(ids.has(result.ruleId), result.ruleId);
		assert.ok(['error', 'warning', 'note'].includes(result.level), result.level);
		assert.equal(typeof result.message.text, 'string');
		for (const { physicalLocation } of result.locations) {
			assert.ok(!physicalLocation.artifactLocation.uri.startsWith('/'), 'a relative uri');
			if (physicalLocation.region !== undefined) assert.ok(physicalLocation.region.startLine >= 1);
		}
	}
	return log.runs[0];
}

test('validate --format sarif: every finding a result at the region of its value in the file', async () => {
	const file = example('chartjs-invalid.json');
	const { code, out } = await run(['validate', '--library', 'chartjs', '--file', file, '--format', 'sarif']);
	assert.equal(code, 1);
	const { results, properties } = assertSarif(JSON.parse(out));
	const min = results.find((result) => result.properties.path === '$.options.scales.y.min');
	assert.equal(min.ruleId, 'CFG_TYPE');
	assert.equal(min.level, 'error');
	assert.equal(min.properties.confidence, 'certain');
	const [{ physicalLocation }] = min.locations;
	assert.equal(physicalLocation.artifactLocation.uri, uriOf(file));
	assert.deepEqual(min.logicalLocations, [{ fullyQualifiedName: '$.options.scales.y.min', kind: 'member' }]);
	// The region holds the value the finding is about.
	assert.ok(physicalLocation.region.startLine > 1);
	assert.equal(min.properties.exact, true);
	// What checked it: a clean partial log is no certification.
	assert.deepEqual(
		[properties.mode, properties.library, typeof properties.schemaVersion],
		['validate', 'chartjs', 'string']
	);
	assert.ok(['partial', 'full'].includes(properties.coverage));
});

test('a region spans the value it is about, its end column exclusive', async (t) => {
	const root = sourceProject(t, { 'typo.json': '{\n  "xAxis": { "type": "catgory" },\n  "yAxis": {}\n}' });
	const { out } = await run([
		'validate',
		'--library',
		'echarts',
		'--file',
		join(root, 'typo.json'),
		'--format',
		'sarif'
	]);
	const [typo] = assertSarif(JSON.parse(out)).results.filter((result) => result.ruleId === 'CFG_ENUM');
	assert.deepEqual(typo.locations[0].physicalLocation.region, {
		startLine: 2,
		startColumn: 22,
		endLine: 2,
		endColumn: 31
	});
	assert.equal(typo.properties.exact, true);
});

test('--json is --format json; two formats, an unknown format or threshold are usage errors', async () => {
	const file = example('chartjs-invalid.json');
	const json = await run(['validate', '--library', 'chartjs', '--file', file, '--json']);
	const format = await run(['validate', '--library', 'chartjs', '--file', file, '--format', 'json']);
	assert.deepEqual(JSON.parse(format.out), JSON.parse(json.out));
	for (const extra of [
		['--json', '--format', 'text'],
		['--format', 'xml'],
		['--fail-on', 'info']
	]) {
		const { code, err } = await run(['validate', '--library', 'chartjs', '--file', file, ...extra]);
		assert.equal(code, 2, extra.join(' '));
		assert.match(err, /format|fail-on/u, extra.join(' '));
	}
});

test('--fail-on: error (the default), warning or never decides the exit status; usage errors stay 2', async (t) => {
	const root = sourceProject(t, {
		'warned.json': JSON.stringify({
			xAxis: { type: 'category', data: ['a'] },
			yAxis: {},
			series: [{ type: 'line', data: [1], unknownOption: 1 }]
		})
	});
	const invalid = example('chartjs-invalid.json');
	const warned = join(root, 'warned.json');
	const status = async (library, file, ...extra) =>
		(await run(['validate', '--library', library, '--file', file, ...extra])).code;
	assert.equal(await status('chartjs', invalid), 1);
	assert.equal(await status('chartjs', invalid, '--fail-on', 'never'), 0);
	assert.equal(await status('chartjs', invalid, '--fail-on', 'warning'), 1);
	assert.equal(await status('echarts', warned), 0);
	assert.equal(await status('echarts', warned, '--fail-on', 'warning'), 1);
	assert.equal(await status('echarts', warned, '--fail-on', 'never'), 0);
	assert.equal(await status('echarts', join(root, 'missing.json'), '--fail-on', 'never'), 2);
});

test('quality is advisory by default; --fail-on warning makes its warnings fail; SARIF keeps suppressed findings as suppressed', async (t) => {
	const file = example('chartjs-quality.json');
	const quality = (...extra) => run(['quality', '--library', 'chartjs', '--file', file, ...extra]);
	assert.equal((await quality()).code, 0);
	assert.equal((await quality('--fail-on', 'error')).code, 0);
	assert.equal((await quality('--fail-on', 'warning')).code, 1);
	const reported = JSON.parse((await quality('--json')).out).diagnostics;
	assert.ok(reported.length > 0);
	const [first] = reported;
	const root = sourceProject(t, {
		'settings.json': JSON.stringify({
			rules: {
				[first.code.toLowerCase().replace(/^vis_/u, '').replaceAll('_', '-')]: {
					ignore: [{ path: first.path, reason: 'shown on a dark page' }]
				}
			}
		})
	});
	const { out } = await quality('--format', 'sarif', '--settings', join(root, 'settings.json'));
	const { results } = assertSarif(JSON.parse(out));
	const suppressed = results.filter((result) => result.suppressions !== undefined);
	assert.deepEqual(
		suppressed.map(({ ruleId, suppressions }) => [ruleId, suppressions]),
		[[first.code, [{ kind: 'external', justification: 'shown on a dark page' }]]]
	);
});

test('analyze --format sarif places each finding at the source range that wrote the value', async (t) => {
	const root = sourceProject(t, {
		'tsconfig.json': '{}',
		'src/chart.ts':
			'import { Chart } from "chart.js";\nnew Chart(el, {\n  type: "bar",\n  data: { datasets: [] },\n  options: { scales: { y: { type: "linear", min: "50" } } }\n});\n'
	});
	const file = join(root, 'src/chart.ts');
	const { code, out } = await run(['analyze', '--library', 'chartjs', '--file', file, '--format', 'sarif']);
	assert.equal(code, 1);
	const { results } = assertSarif(JSON.parse(out));
	const min = results.find((result) => result.properties.path === '$.options.scales.y.min');
	assert.equal(min.locations[0].physicalLocation.artifactLocation.uri, uriOf(file));
	assert.deepEqual(min.locations[0].physicalLocation.region, {
		startLine: 5,
		startColumn: 50,
		endLine: 5,
		endColumn: 54
	});
});

test('an info finding is a SARIF note; quality says when it can fail the run', async (t) => {
	const root = sourceProject(t, { 'untyped.json': '{ "data": { "datasets": [] } }' });
	const { code, out } = await run([
		'validate',
		'--library',
		'chartjs',
		'--file',
		join(root, 'untyped.json'),
		'--format',
		'sarif'
	]);
	assert.equal(code, 0);
	const [ambiguous] = assertSarif(JSON.parse(out)).results;
	assert.deepEqual(
		[ambiguous.ruleId, ambiguous.level, ambiguous.properties.confidence],
		['CFG_AMBIGUOUS', 'note', 'unknown']
	);
	const quality = (...extra) =>
		run(['quality', '--library', 'chartjs', '--file', example('chartjs-quality.json'), ...extra]);
	assert.match((await quality()).out, /fail a build only with --fail-on warning/u);
	assert.match((await quality('--fail-on', 'warning')).out, /--fail-on warning makes them fail this run/u);
});
