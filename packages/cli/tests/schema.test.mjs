import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { main } from '../bin/chartguard.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

async function run(argv) {
	const out = [];
	const err = [];
	const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
	return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A user's project with highcharts linked from this repository's install, and a config in a subdirectory. */
function project(t, { highcharts = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-cli-schema-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'node_modules'));
	mkdirSync(join(root, 'src', 'charts'), { recursive: true });
	if (highcharts)
		symlinkSync(join(ROOT, 'node_modules', 'highcharts'), join(root, 'node_modules', 'highcharts'), 'dir');
	// `chart.zooming.type` is checked by the full schema only; the curated subset leaves `zooming` open.
	const config = join(root, 'src', 'charts', 'chart.json');
	writeFileSync(config, JSON.stringify({ chart: { zooming: { type: 'xyz' } }, series: [{ type: 'line', data: [1] }] }));
	const source = join(root, 'src', 'charts', 'chart.ts');
	writeFileSync(
		source,
		"export const config = { chart: { zooming: { type: 'xyz' } }, series: [{ type: 'line', data: [1] }] };"
	);
	return { root, config, source, schema: join(root, 'node_modules/.cache/chartguard/highcharts-13.1.1.json') };
}

test('schema build writes the Highcharts schema of the installed version into the project, and says where', async (t) => {
	const { root, schema } = project(t);
	const built = await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	assert.equal(built.code, 0, built.err);
	assert.match(built.out, /^highcharts 13\.1\.1 schema built from your install \(sha256-[0-9a-f]{12}\)$/m);
	assert.match(built.out, new RegExp(`^  ${schema.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
	const json = await run(['schema', 'build', '--library', 'highcharts', '--dir', root, '--json']);
	assert.deepEqual(Object.keys(JSON.parse(json.out)), ['mode', 'library', 'version', 'path', 'digest', 'integrity']);
	assert.equal(JSON.parse(readFileSync(schema, 'utf8')).libraryVersion, '13.1.1');
});

test('schema build: a library whose schema ships, or a project without the library, is an input error', async (t) => {
	const shipped = await run(['schema', 'build', '--library', 'chartjs', '--dir', project(t).root]);
	assert.deepEqual(
		[shipped.code, shipped.err],
		[2, 'ChartGuard: chartjs ships its schema with its adapter; there is nothing to build.']
	);
	const missing = await run([
		'schema',
		'build',
		'--library',
		'highcharts',
		'--dir',
		project(t, { highcharts: false }).root
	]);
	assert.equal(missing.code, 2);
	assert.match(missing.err, /highcharts is not installed in /);
});

test('schema build takes --library, --dir and --json only', async () => {
	for (const argv of [
		['schema'],
		['schema', 'make', '--library', 'highcharts'],
		['schema', 'build'],
		['schema', 'build', '--library', 'highcharts', '--file', 'x.json'],
		['schema', 'build', '--library', 'highcharts', '--library-version', '13.1.1'],
		['validate', '--library', 'highcharts', '--file', 'x.json', '--dir', '.']
	])
		assert.equal((await run(argv)).code, 2, argv.join(' '));
});

test('validate uses the schema built for the installed version, and names it', async (t) => {
	const { root, config, schema } = project(t);
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	const text = await run(['validate', '--library', 'highcharts', '--file', config]);
	assert.equal(text.code, 1);
	assert.match(text.out, /ERROR CFG_ENUM \$\.chart\.zooming\.type/);
	assert.match(text.out, /schema: built from your highcharts 13\.1\.1/);
	const json = JSON.parse((await run(['validate', '--library', 'highcharts', '--file', config, '--json'])).out);
	assert.deepEqual(json.schema, { kind: 'generated', path: schema, version: '13.1.1' });
	assert.equal(json.schemaVersion, '13.1.1');
});

test('without a schema for the installed version, validate uses the curated subset and says how to build one', async (t) => {
	const { root, config, schema } = project(t);
	const curated = await run(['validate', '--library', 'highcharts', '--file', config]);
	assert.equal(curated.code, 0);
	assert.match(
		curated.out,
		/schema: curated subset; for the full schema run `chartguard schema build --library highcharts`/
	);
	// A schema built for another version is never used for this install.
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	const other = schema.replace('13.1.1', '13.0.9');
	writeFileSync(other, readFileSync(schema, 'utf8'));
	rmSync(schema);
	const json = JSON.parse((await run(['validate', '--library', 'highcharts', '--file', config, '--json'])).out);
	assert.deepEqual(json.schema, { kind: 'curated' });
});

test('a corrupt built schema is an input error that says to rebuild it', async (t) => {
	const { root, config, schema } = project(t);
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	writeFileSync(schema, '{"irVersion": 1}');
	const broken = await run(['validate', '--library', 'highcharts', '--file', config]);
	assert.equal(broken.code, 2);
	assert.match(broken.err, /cannot be used: .*\n.*Rebuild it: chartguard schema build --library highcharts/s);
});

test('analyze validates every extracted config with the built schema too', async (t) => {
	const { root, source } = project(t);
	await run(['schema', 'build', '--library', 'highcharts', '--dir', root]);
	const analyzed = await run(['analyze', '--library', 'highcharts', '--file', source, '--json']);
	const report = JSON.parse(analyzed.out);
	assert.equal(report.schema.kind, 'generated');
	assert.deepEqual(
		report.entries[0].result.diagnostics.map((d) => d.code),
		['CFG_ENUM']
	);
});

test('the shipped schemas are named as such', async (t) => {
	const { root } = project(t);
	const file = join(root, 'chart.json');
	writeFileSync(file, JSON.stringify({ type: 'bar', data: { datasets: [] } }));
	const json = JSON.parse((await run(['validate', '--library', 'chartjs', '--file', file, '--json'])).out);
	assert.deepEqual(json.schema, { kind: 'shipped' });
});
