import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { validate as validateChartjs } from '@chartguard/config-chartjs';
import { validate as validateEcharts } from '@chartguard/config-echarts';
import * as chartjs from 'chart.js';
import * as chartjsHelpers from 'chart.js/helpers';
import * as echarts from 'echarts';
import ts from 'typescript';

import { isEntryPoint } from '../../shared/entry.mjs';
import { verdictOf } from '../lib/capture.mjs';
import { runChartjs } from '../lib/chartjs.mjs';
import { runEcharts } from '../lib/echarts.mjs';
import { createUtils } from './chartjs-utils.mjs';

/**
 * Runs one pinned example corpus. Started by lib/sandbox.mjs in a separate process under the
 * Node permission model (read-only file system, no child processes, no workers); inside it each
 * example runs in a fresh `vm` context without `require`, `process`, `fetch` or dynamic import.
 * Prints one JSON array of outcomes on stdout.
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
	return new Proxy(target, { get: (_, key) => (key === Symbol.toPrimitive ? () => '' : inert()), apply: () => inert() });
}

/** A plain object of any realm: its prototype is null or that realm's `Object.prototype`. */
function isPlainObject(value) {
	if (value === null || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * Objects built inside the `vm` context belong to another realm, and runtimes test
 * `value.constructor === Object` (Chart.js `needsSubResolver`) to decide whether to merge
 * defaults. Plain objects and arrays are therefore rebuilt in this realm before validation and
 * rendering; functions, class instances, dates and typed arrays are kept as they are.
 */
export function toHostRealm(value, copies = new Map()) {
	if (copies.has(value)) return copies.get(value);
	if (Array.isArray(value)) {
		const copy = [];
		copies.set(value, copy);
		for (let index = 0; index < value.length; index++) if (index in value) copy[index] = toHostRealm(value[index], copies);
		copy.length = value.length;
		return copy;
	}
	if (!isPlainObject(value)) return value;
	const copy = {};
	copies.set(value, copy);
	for (const [key, entry] of Object.entries(value)) copy[key] = toHostRealm(entry, copies);
	return copy;
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
			const globals = { echarts, myChart: inert(), $: inert(), app: {}, ROOT_PATH: '', CDN_PATH: '', exports: {}, option: undefined };
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
	config = toHostRealm(config);
	const findings = library.validate(config).diagnostics.map((d) => `${d.severity} ${d.code} ${d.path}`);
	const observed = library.render(config);
	const messages = observed.messages.map(({ text }) => text);
	return { path, status: 'ran', findings, runtime: verdictOf(observed), ...(observed.threw === undefined ? {} : { threw: observed.threw }), messages };
}

function main([libraryName, corpusPath]) {
	const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
	const library = LIBRARIES[libraryName];
	process.stdout.write(JSON.stringify(corpus.files.map((file) => outcomeOf(library, file))));
}

if (isEntryPoint(import.meta.url)) main(process.argv.slice(2));
