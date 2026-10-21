import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

import { browserSkipReason, dumpDom } from '../../shared/chrome.mjs';

/**
 * The M4 gate: a real application per runtime adapter (examples/runtime-apps), imported by package
 * name, type-checked against the libraries' own declarations, bundled as an application would be
 * (development builds, as for every runtime verdict) and run in headless Chrome.
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const APPS = join(ROOT, 'examples', 'runtime-apps');
const LOCAL_SCHEMA = join(ROOT, 'node_modules', '.cache', 'chartguard', 'highcharts-13.1.1.json');

const unescape = (text) => text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** Bundles `src/<name>.ts` and runs it on a page of its own; returns what it wrote into `#report`. */
async function runApp(name, before = '') {
	const { outputFiles } = await build({
		entryPoints: [join(APPS, 'src', `${name}.ts`)],
		bundle: true,
		format: 'iife',
		platform: 'browser',
		write: false,
		define: { 'process.env.NODE_ENV': '"development"' },
		logLevel: 'silent'
	});
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-app-'));
	try {
		writeFileSync(join(directory, 'app.js'), outputFiles[0].text);
		writeFileSync(join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><body>${before}<script src="app.js"></script>`);
		const html = await dumpDom(pathToFileURL(join(directory, 'index.html')).href);
		const found = /<pre id="report">([^<]*)<\/pre>/.exec(html);
		assert.ok(found !== null, `the ${name} app wrote no report`);
		return JSON.parse(unescape(found[1]));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

test('the sample apps type-check against the libraries’ own declarations', () => {
	const tsc = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(APPS, 'tsconfig.json')], { encoding: 'utf8' });
	assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
});

const browser = { skip: browserSkipReason() ?? false };

test('Chart.js app: a tree-shaken chart is checked at creation and update; what Chart.js would reject is blocked', browser, async () => {
	const report = await runApp('chartjs');
	assert.deepEqual(report, {
		library: 'chartjs',
		// A responsive chart updates again once it is attached to the page (Chart.js resizes it): that
		// update is checked too, and the blocked bar chart stays blocked.
		results: [
			{ phase: 'create', valid: true, errors: [] },
			{ phase: 'update', valid: true, errors: [] },
			{ phase: 'update', valid: false, errors: ['CFG_TYPE $.data.datasets[0].borderWidth'] },
			{ phase: 'create', valid: false, errors: ['CFG_UNREGISTERED $.data.datasets[0]'] },
			{ phase: 'update', valid: false, errors: ['CFG_UNREGISTERED $.data.datasets[0]'] }
		],
		threw: false,
		instances: 0,
		globalsUnchanged: true
	});
});

test('ECharts app: a fresh option, a merge update and an unregistered series on a tree-shaken runtime', browser, async () => {
	const report = await runApp('echarts');
	assert.deepEqual(report, {
		library: 'echarts',
		results: [
			{ phase: 'fresh', valid: true, errors: [] },
			{ phase: 'merge', valid: true, errors: [] },
			{ phase: 'fresh', valid: false, errors: ['CFG_UNREGISTERED $.series[0].type'] }
		],
		series: ['line 4,5'],
		globalsUnchanged: true
	});
});

test('Highcharts app: creation, typed updates, addSeries and a series of a module the page did not load', browser, async () => {
	const schema = `<script>globalThis.chartguardHighchartsSchema = ${readFileSync(LOCAL_SCHEMA, 'utf8').replaceAll('<', '\\u003c')};</script>`;
	const report = await runApp('highcharts', schema);
	assert.deepEqual(report, {
		library: 'highcharts',
		results: [
			{ phase: 'create', valid: true, errors: [] },
			{ phase: 'update', valid: false, errors: ['CFG_TYPE $.series[0].pointPadding'] },
			{ phase: 'update', valid: true, errors: [] },
			{ phase: 'addSeries', valid: true, errors: [] },
			{ phase: 'create', valid: false, errors: ['CFG_UNREGISTERED $.series[0].type'] }
		],
		// The added series has Highcharts' default pointPadding; the blocked 'wide' never reached the chart.
		series: ['column 0.2', 'column 0.1'],
		sankey: true,
		globalsUnchanged: true
	});
});
