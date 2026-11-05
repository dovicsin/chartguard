import assert from 'node:assert/strict';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';

import plugin from '../dist/index.js';

/**
 * What the project installs (CG-06-03 part 2): `libraryVersion: "auto"` reads the version from the
 * linted file's `node_modules`, and Highcharts is checked with the schema built for exactly that version.
 */
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const CHART = "import { Chart } from 'chart.js';\n";
const WRONG_MIN = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;

/** A project with the given packages installed (`name` → `version`), removed after the test. */
function project(t, installed = {}) {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-eslint-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [name, version] of Object.entries(installed)) {
		mkdirSync(join(root, 'node_modules', name), { recursive: true });
		writeFileSync(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
	}
	mkdirSync(join(root, 'src', 'charts'), { recursive: true });
	return root;
}

/** ESLint's config findings for `code` in the file `root/file`, ESLint working in `root` (a file outside it matches no config). */
const lint = (code, root, file, chartguard) =>
	new Linter({ cwd: root })
		.verify(code, [{ ...plugin.configs.recommended, settings: { chartguard } }], { filename: join(root, file) })
		.filter(({ ruleId }) => ruleId !== 'chartguard/chart-quality')
		.map(({ ruleId, message }) => `${ruleId} ${message.split(':')[0]}`);

test('libraryVersion "auto": the version installed for the linted file, found upwards from it', (t) => {
	const root = project(t, { 'chart.js': '4.4.1' });
	const auto = { libraryVersion: { chartjs: 'auto' } };
	assert.deepEqual(lint(WRONG_MIN, root, 'src/charts/bar.js', auto), [
		'chartguard/config-warnings CFG_VERSION_MISMATCH $',
		'chartguard/config-warnings CFG_TYPE $.options.scales.y.min'
	]);
	const old = project(t, { 'chart.js': '3.9.1' });
	assert.deepEqual(lint(WRONG_MIN, old, 'src/bar.js', auto), ['chartguard/config-warnings CFG_UNSUPPORTED_VERSION $']);
	// The pinned version installed: the findings are confirmed.
	const pinned = project(t, { 'chart.js': '4.5.1' });
	assert.deepEqual(lint(WRONG_MIN, pinned, 'src/bar.js', auto), [
		'chartguard/valid-config CFG_TYPE $.options.scales.y.min'
	]);
});

test('libraryVersion "auto" without an install is a setup error naming the setting, only where the library is used', (t) => {
	const root = project(t);
	const auto = { libraryVersion: { chartjs: 'auto' } };
	assert.throws(
		() => lint(WRONG_MIN, root, 'src/bar.js', auto),
		/settings\.chartguard\.libraryVersion\.chartjs: "auto", but chart\.js is not installed for .*src; name the version/u
	);
	assert.deepEqual(lint('export const a = 1;', root, 'src/a.js', auto), []);
	// A package.json without a version is no install.
	const unversioned = project(t);
	mkdirSync(join(unversioned, 'node_modules', 'chart.js'), { recursive: true });
	writeFileSync(join(unversioned, 'node_modules', 'chart.js', 'package.json'), '{ "name": "chart.js" }');
	assert.throws(() => lint(WRONG_MIN, unversioned, 'src/bar.js', auto), /chart\.js is not installed for /u);
});

/** A project with the repository's highcharts and its locally built schema (`npm run build` writes it). */
function highchartsProject(t, version = '13.1.1') {
	const root = project(t);
	mkdirSync(join(root, 'node_modules', '.cache', 'chartguard'), { recursive: true });
	symlinkSync(join(ROOT, 'node_modules', 'highcharts'), join(root, 'node_modules', 'highcharts'), 'dir');
	copyFileSync(
		join(ROOT, 'node_modules', '.cache', 'chartguard', 'highcharts-13.1.1.json'),
		join(root, 'node_modules', '.cache', 'chartguard', `highcharts-${version}.json`)
	);
	return root;
}

const HIGHCHARTS =
	"import Highcharts from 'highcharts';\nHighcharts.chart('c', { chart: { zooming: { type: 'xyz' } }, series: [] });";

test('Highcharts: the schema built for exactly the installed version checks what the curated subset cannot', (t) => {
	const curated = lint(HIGHCHARTS, project(t), 'src/a.js', {});
	assert.deepEqual(curated, []);
	const built = highchartsProject(t);
	assert.deepEqual(lint(HIGHCHARTS, built, 'src/a.js', {}), ['chartguard/valid-config CFG_ENUM $.chart.zooming.type']);
	// A schema built for another version is never used.
	const other = highchartsProject(t, '13.0.0');
	assert.deepEqual(lint(HIGHCHARTS, other, 'src/a.js', {}), []);
});

test('Highcharts: plugin schemas extend the built schema; a schema that cannot be read says to rebuild it', (t) => {
	const built = highchartsProject(t);
	const code =
		"import Highcharts from 'highcharts';\nHighcharts.chart('c', { series: [{ type: 'mine', data: [1] }] });";
	const mine = { id: 'mine', variants: { 'highcharts.series': { mine: { extends: 'line' } } } };
	assert.deepEqual(lint(code, built, 'src/a.js', { extensions: { highcharts: [mine] } }), []);
	// Without the built schema the curated subset refuses them rather than drop them.
	assert.throws(
		() => lint(code, project(t), 'src/a.js', { extensions: { highcharts: [mine] } }),
		/settings\.chartguard\.extensions\.highcharts: the curated Highcharts subset has no extension points; build the full schema/u
	);
	// Built by another generator (CG-07-06): rebuilt, never used as if it were this one's.
	const path = join(built, 'node_modules', '.cache', 'chartguard', 'highcharts-13.1.1.json');
	const artifact = JSON.parse(readFileSync(path, 'utf8'));
	writeFileSync(path, JSON.stringify({ ...artifact, generator: { ...artifact.generator, version: '0.0.9' } }));
	assert.throws(
		() => lint(code, built, 'src/a.js', {}),
		/highcharts-13\.1\.1\.json cannot be used: it was built by @chartguard\/schema-generator 0\.0\.9 with typescript@\S+; this ChartGuard builds with .*\nRebuild it: chartguard schema build --library highcharts/u
	);
	writeFileSync(join(built, 'node_modules', '.cache', 'chartguard', 'highcharts-13.1.1.json'), '{ broken');
	assert.throws(
		() => lint(code, built, 'src/a.js', {}),
		/node_modules\/\.cache\/chartguard\/highcharts-13\.1\.1\.json cannot be used: .*\nRebuild it: chartguard schema build --library highcharts/u
	);
});

test('one ESLint run reads a built schema once, and again when the file on disk changes', async (t) => {
	const built = highchartsProject(t);
	const schema = join(built, 'node_modules', '.cache', 'chartguard', 'highcharts-13.1.1.json');
	// A whole second, which every file system keeps exactly.
	const time = new Date(1_700_000_000_000);
	utimesSync(schema, time, time);
	// One ESLint instance gives every file the same settings object, as a lint run does.
	const eslint = new ESLint({
		cwd: built,
		overrideConfigFile: true,
		overrideConfig: [{ ...plugin.configs.recommended, settings: { chartguard: {} } }]
	});
	const run = async () => {
		const [result] = await eslint.lintText(HIGHCHARTS, { filePath: join(built, 'src', 'a.js') });
		return result.messages.map(({ ruleId }) => ruleId);
	};
	assert.ok((await run()).includes('chartguard/valid-config'));
	// Same size and time: the same file as far as its stamp tells; the validator built from it is kept.
	writeFileSync(schema, ' '.repeat(statSync(schema).size));
	utimesSync(schema, time, time);
	assert.ok((await run()).includes('chartguard/valid-config'));
	// Changed on disk: read again, and a schema that does not load says so.
	writeFileSync(schema, '{ broken');
	await assert.rejects(run, /cannot be used/u);
});
