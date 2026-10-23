import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import * as chartjs from 'chart.js';
import * as chartjsHelpers from 'chart.js/helpers';
import * as echarts from 'echarts';
import ts from 'typescript';

import { runAsEntryPoint } from '../../shared/entry.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';
import { copyPlain } from '../lib/copy.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { createUtils } from './chartjs-utils.mjs';

/**
 * Runs one pinned example corpus. Started by lib/sandbox.mjs in a separate process under the
 * Node permission model (read-only file system, no child processes, no workers) with an empty
 * environment; that process is the boundary. Each example runs in a fresh `vm` context without
 * `require`, `process`, `fetch` or dynamic import as globals, but a `vm` context is not a security
 * boundary: through any object handed in (`Chart`) the code reaches this realm's `globalThis`, and
 * so `process` and the network (K6). Prints one JSON array of outcomes on stdout.
 */
/**
 * Only a guard against examples that never finish. It must stay far above any honest run under
 * load (coverage instrumentation, parallel test files): `bar-large` builds 500 000 points and
 * took over 2 s that way, which made a tight limit flaky.
 */
const EXAMPLE_TIMEOUT_MS = 30_000;
const SEEDED_RANDOM = 'let s = 42; Math.random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };';
const SILENT_CONSOLE = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

/** Any property, any call, any depth: stands in for `myChart`, `$`, `app` and friends. */
function inert() {
	const target = function () {};
	return new Proxy(target, {
		get: (_, key) => (key === Symbol.toPrimitive ? () => '' : inert()),
		apply: () => inert()
	});
}

function evaluate(code, globals) {
	const context = vm.createContext({ console: SILENT_CONSOLE, ...globals });
	vm.runInContext(SEEDED_RANDOM, context);
	vm.runInContext(code, context, { timeout: EXAMPLE_TIMEOUT_MS });
	return context;
}

export const LIBRARIES = {
	chartjs: {
		build(code) {
			// The docs chart-editor exposes `Chart`, `helpers` and the chart.js exports as `components`.
			const globals = { Utils: createUtils(), Chart: chartjs.Chart, helpers: chartjsHelpers, components: chartjs };
			const context = evaluate(code, { ...globals, module: { exports: {} } });
			return context.module.exports.config;
		},
		validate: validateChartjs,
		render: runChartjs
	},
	echarts: {
		build(code) {
			const { outputText } = ts.transpileModule(code, {
				compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
			});
			const globals = {
				echarts,
				myChart: inert(),
				$: inert(),
				app: {},
				ROOT_PATH: '',
				CDN_PATH: '',
				exports: {},
				option: undefined
			};
			const timers = { setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {} };
			return evaluate(outputText, { ...globals, ...timers }).option;
		},
		validate: validateEcharts,
		render: runEcharts
	}
};

export function outcomeOf(library, { path, code }) {
	let config;
	try {
		config = library.build(code);
	} catch (error) {
		return { path, status: 'example-threw', error: error instanceof Error ? error.message : String(error) };
	}
	if (config === null || typeof config !== 'object') return { path, status: 'no-config' };
	// vm objects belong to another realm; runtimes test `value.constructor === Object` (Chart.js `needsSubResolver`).
	config = copyPlain(config);
	const findings = library.validate(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
	const observed = library.render(config);
	const messages = observed.messages.map(({ text }) => text);
	return {
		path,
		status: 'ran',
		findings,
		runtime: verdictOf(observed),
		...(observed.threw === undefined ? {} : { threw: observed.threw }),
		messages
	};
}

function main([libraryName, corpusPath]) {
	const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
	const library = LIBRARIES[libraryName];
	process.stdout.write(JSON.stringify(corpus.files.map((file) => outcomeOf(library, file))));
}

await runAsEntryPoint(import.meta.url, main);
