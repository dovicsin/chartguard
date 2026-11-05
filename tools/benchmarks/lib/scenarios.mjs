import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { extractStaticConfigs } from '@chartguard/analysis-typescript';
import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import { validate as validateHighcharts } from '@chartguard/config-highcharts';
import { analyze as analyzeChartjs } from '@chartguard/quality-chartjs';
import { analyze as analyzeEcharts } from '@chartguard/quality-echarts';
import { analyze as analyzeHighcharts } from '@chartguard/quality-highcharts';
import { SourceChecker } from '@chartguard/source-checks';
import { build } from 'esbuild';

import { bundleOptions, frameOptions } from '../../../apps/playground/scripts/build.mjs';
import { connect } from '../../../packages/integrations/language-server/tests/client.mjs';
import { corpus } from '../../fuzz/lib/hostile.mjs';
import { fastestAsync, inUnits, probe, reference, RUNS } from './measure.mjs';

/**
 * What is measured (CG-07-03 parts 1 and 2): each a `measure({ runs })` giving a number in `unit` (`units`:
 * reference units, see `measure.mjs`; `MB`: peak RSS of a fresh process; `KB`: gzip size). Budgets
 * are in `budgets.mjs`.
 */

/** A config of `points` points per library, the shape the runtime wrappers' budget uses. */
const LARGE = {
	chartjs: (points) => ({
		type: 'line',
		data: {
			labels: Array.from({ length: points }, (_, index) => `l${String(index)}`),
			datasets: [{ label: 'a', data: Array.from({ length: points }, (_, index) => index % 97) }]
		}
	}),
	echarts: (points) => ({
		xAxis: { type: 'category' },
		yAxis: { type: 'value' },
		series: [{ type: 'line', name: 'a', data: Array.from({ length: points }, (_, index) => index % 97) }]
	}),
	highcharts: (points) => ({
		series: [{ type: 'line', name: 'a', data: Array.from({ length: points }, (_, index) => index % 97) }]
	})
};

const LIBRARIES = {
	chartjs: { validate: validateChartjs, analyze: analyzeChartjs },
	echarts: { validate: validateEcharts, analyze: analyzeEcharts },
	highcharts: { validate: validateHighcharts, analyze: analyzeHighcharts }
};

/** A TypeScript file with `charts` Chart.js charts, each config a constant. */
function chartsFile(charts) {
	const lines = ["import { Chart } from 'chart.js';"];
	for (let index = 0; index < charts; index += 1) {
		const name = `c${String(index)}`;
		lines.push(
			`const ${name} = { type: 'bar', data: { labels: ['a', 'b'], datasets: [{ label: '${name}', data: [${String(index)}, 2] }] }, options: { scales: { y: { min: 0 } } } };`,
			`new Chart(document.createElement('canvas'), ${name});`
		);
	}
	return lines.join('\n');
}

/** An editor's buffer: one chart with a wrong axis value. */
const EDITOR_BUFFER =
	"import { Chart } from 'chart.js';\nnew Chart(document.createElement('canvas'), { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'a', data: [1] }] }, options: { scales: { y: { min: 'x' } } } });\n";

/**
 * The results of fresh-process probes for one measurement, memoized: a probe measures several things
 * at once. A first measurement runs one probe, the longer re-measure of an overrun three, each
 * scenario keeping the least of its value (a single fresh process has no run to take the fastest of).
 */
function probed(run) {
	const results = new Map();
	return (runs) => {
		if (!results.has(runs)) results.set(runs, Array.from({ length: runs > RUNS ? 3 : 1 }, run));
		return results.get(runs);
	};
}

/** The least value of `metric` over the probes' results. */
const least = (results, metric) => Math.min(...results.map(metric));

const coldOf = Object.fromEntries(
	Object.keys(LIBRARIES).map((library) => [library, probed(() => probe('cold', [library], ['ms', 'rss', 'unit']))])
);
const PROJECT_FILES = 50;
const project = probed(() => {
	const result = probe('project', [String(PROJECT_FILES)], ['open', 'edit', 'findings', 'rss', 'unit']);
	if (result.findings === 0) throw new Error('the project probe found nothing to report: it measured no check');
	return result;
});

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The gzip KB of the JavaScript an esbuild build writes (in memory; a `stdin` build's output has no extension). */
async function bundledKb(options) {
	const { outputFiles } = await build({
		...options,
		write: false,
		metafile: false,
		sourcemap: false,
		logLevel: 'silent'
	});
	return outputFiles
		.filter((file) => !file.path.endsWith('.map') && !file.path.endsWith('.css'))
		.reduce((total, file) => total + gzipSync(file.contents).length / 1024, 0);
}

/**
 * What a runtime wrapper adds to an application's bundle: the package, minified for production, its
 * chart library left to the application (a peer dependency).
 */
const runtimeKb = (library, runtime) => () =>
	bundledKb({
		stdin: { contents: `export * from '@chartguard/runtime-${runtime}';`, resolveDir: ROOT, loader: 'js' },
		bundle: true,
		minify: true,
		format: 'esm',
		platform: 'browser',
		define: { 'process.env.NODE_ENV': '"production"' },
		external: [library, `${library}/*`]
	});

/** The playground's JavaScript: its page with every lazily loaded chunk, and its drawing frame. */
const playgroundKb = async () => {
	const outdir = join(ROOT, 'node_modules', '.cache', 'chartguard-bench-playground');
	return (await bundledKb(bundleOptions(outdir))) + (await bundledKb(frameOptions(outdir)));
};

/** An editor buffer with a wrong value, `round` making each text new. */
const wrongBuffer = (round) => EDITOR_BUFFER.replace("'x'", `'x${String(round)}'`);

/**
 * The language server's answer to an edit, over its protocol in this process: from the change
 * notification to the diagnostics it publishes. The server's wait before it checks (200 ms, so
 * typing does not check every key) is set to 0: what is measured is the work.
 */
async function serverEdit({ runs }) {
	const client = connect({ delay: 0 });
	await client.initialize();
	const uri = pathToFileURL(join(process.cwd(), 'chart.ts')).href;
	await client.open(uri, wrongBuffer(0), 'typescript');
	let round = 0;
	const edit = async () => {
		round += 1;
		client.notify('textDocument/didChange', {
			textDocument: { uri, version: round + 1 },
			contentChanges: [{ text: wrongBuffer(round) }]
		});
		const { params } = await client.next('textDocument/publishDiagnostics');
		if (params.diagnostics.length === 0) throw new Error('the server published nothing: it measured no check');
	};
	const [time, unit] = await fastestAsync([edit, async () => reference()], runs);
	await client.request('shutdown');
	client.notify('exit');
	return time / unit;
}

const cli = probed(() => probe('cli', [], ['ms', 'unit']));
const server = probed(() => probe('server', [], ['start', 'unit']));

const schemaKb = (url) => async () => gzipSync(readFileSync(new URL(url, import.meta.url))).length / 1024;

const libraryScenarios = Object.entries(LIBRARIES).flatMap(([library, { validate, analyze }]) => {
	const configs = [];
	const large = LARGE[library](10_000);
	return [
		{
			id: `validate-${library}-corpus`,
			unit: 'units',
			measure: async ({ runs }) => {
				if (configs.length === 0) configs.push(...(await corpus(library)));
				return inUnits(() => configs.forEach((config) => validate(config)), runs);
			}
		},
		{
			id: `quality-${library}-corpus`,
			unit: 'units',
			measure: async ({ runs }) => {
				if (configs.length === 0) configs.push(...(await corpus(library)));
				return inUnits(() => configs.forEach((config) => analyze(config)), runs);
			}
		},
		{
			id: `quality-${library}-10000-points`,
			unit: 'units',
			measure: async ({ runs }) => inUnits(() => analyze(large), runs)
		},
		{
			id: `cold-${library}-time`,
			unit: 'units',
			measure: async ({ runs }) => least(coldOf[library](runs), ({ ms, unit }) => ms / unit)
		},
		{
			id: `cold-${library}-memory`,
			unit: 'MB',
			measure: async ({ runs }) => least(coldOf[library](runs), ({ rss }) => rss)
		}
	];
});

export const SCENARIOS = [
	...libraryScenarios,
	{
		id: 'analysis-200-charts',
		unit: 'units',
		measure: async ({ runs }) => {
			const source = chartsFile(200);
			return inUnits(() => extractStaticConfigs(source, 'charts.ts'), Math.min(runs, 5));
		}
	},
	{
		id: 'editor-check',
		unit: 'units',
		measure: async ({ runs }) => {
			const checker = new SourceChecker(undefined, 'chartguard');
			const cwd = process.cwd();
			return inUnits(() => checker.check(EDITOR_BUFFER, `${cwd}/chart.ts`, cwd), runs);
		}
	},
	{
		id: `editor-project-${String(PROJECT_FILES)}-files-open`,
		unit: 'units',
		measure: async ({ runs }) => least(project(runs), ({ open, unit }) => open / unit)
	},
	{
		id: `editor-project-${String(PROJECT_FILES)}-files-edit`,
		unit: 'units',
		measure: async ({ runs }) => least(project(runs), ({ edit, unit }) => edit / unit)
	},
	{
		id: `editor-project-${String(PROJECT_FILES)}-files-memory`,
		unit: 'MB',
		measure: async ({ runs }) => least(project(runs), ({ rss }) => rss)
	},
	{ id: 'server-edit', unit: 'units', measure: serverEdit },
	{
		id: 'server-start',
		unit: 'units',
		measure: async ({ runs }) => least(server(runs), ({ start, unit }) => start / unit)
	},
	{
		id: 'cli-validate',
		unit: 'units',
		measure: async ({ runs }) => least(cli(runs), ({ ms, unit }) => ms / unit)
	},
	{ id: 'bundle-runtime-chartjs-gzip', unit: 'KB', measure: runtimeKb('chart.js', 'chartjs') },
	{ id: 'bundle-runtime-echarts-gzip', unit: 'KB', measure: runtimeKb('echarts', 'echarts') },
	{ id: 'bundle-runtime-highcharts-gzip', unit: 'KB', measure: runtimeKb('highcharts', 'highcharts') },
	{ id: 'bundle-playground-gzip', unit: 'KB', measure: playgroundKb },
	{
		id: 'schema-chartjs-gzip',
		unit: 'KB',
		measure: schemaKb('../../../packages/config/chartjs/dist/generated/chartjs-4.6.1.json')
	},
	{
		id: 'schema-echarts-gzip',
		unit: 'KB',
		measure: schemaKb('../../../packages/config/echarts/dist/generated/echarts-6.1.0.json')
	}
];
