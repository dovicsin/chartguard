import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dumpDom } from '../../shared/chrome.mjs';
import { isJsonOrUndefined } from './json.mjs';

/** The pinned highcharts package the conformance pages load their scripts from. */
export const PACKAGE = fileURLToPath(new URL('../../../node_modules/highcharts/', import.meta.url));
/** Loaded on every page: Highcharts recommends it and warns on every chart rendered without it. */
const ALWAYS = ['accessibility'];
const MODULE_NAME = /^[\w-]+$/;
const UNDEFINED = '__chartguardUndefined';
/** The first data value of an update item's marker (see `UPDATES`). */
const UPDATE_MARK = 1000;

/**
 * Runs in the page. Renders every option into its own container and records how Highcharts
 * reacted: what it reported through `displayError` (an error or a warning, also the ones its own
 * console de-duplication would hide after the first chart), other console output, and a throw.
 */
const REVIVE = `
const revive = (value) => {
	if (value === null || typeof value !== 'object') return value;
	if (value[UNDEFINED] === true) return undefined;
	for (const key of Object.keys(value)) value[key] = revive(value[key]);
	return value;
};
`;
const RUNNER = `${REVIVE}
const outcomes = [];
let current;
Highcharts.addEvent(Highcharts, 'displayError', (event) => {
	current.messages.push({ channel: event.message.startsWith('Highcharts error') ? 'error' : 'warn', text: event.message });
});
for (const options of CASES.map(revive)) {
	current = { messages: [] };
	const original = { warn: console.warn, error: console.error };
	const reported = (text) => current.messages.some((message) => message.text === text);
	for (const channel of ['warn', 'error'])
		console[channel] = (...parts) => {
			const text = parts.map(String).join(' ');
			if (!reported(text)) current.messages.push({ channel, text });
		};
	const container = document.createElement('div');
	container.style.cssText = 'width: 400px; height: 300px';
	document.body.append(container);
	try {
		Highcharts.chart(container, options).destroy();
	} catch (error) {
		current.threw = error instanceof Error ? error.message : String(error);
	} finally {
		Object.assign(console, original);
	}
	outcomes.push(current);
}
document.getElementById('outcomes').textContent = encodeURIComponent(JSON.stringify(outcomes));
`;

function scriptFor(file) {
	const path = join(PACKAGE, file);
	if (!existsSync(path)) throw new Error(`not a highcharts file: ${file}`);
	return `<script src="${pathToFileURL(path).href}"></script>`;
}

/** The development builds (`.src.js`), as for every runtime verdict, with the modules a case needs. */
function page(configs, modules, runner) {
	for (const name of modules) if (!MODULE_NAME.test(name)) throw new Error(`not a module name: ${name}`);
	const scripts = ['highcharts.src.js', ...modules.map((name) => `modules/${name}.src.js`)].map(scriptFor);
	// An explicit `undefined` travels as a marker the page turns back into `undefined`; `<` is
	// escaped so no option text can close the script element.
	const data = JSON.stringify(configs, (_, value) => (value === undefined ? { [UNDEFINED]: true } : value)).replaceAll('<', '\\u003c');
	const marker = JSON.stringify(UNDEFINED);
	return `<!doctype html><meta charset="utf-8"><body>${scripts.join('')}<pre id="outcomes"></pre><script>const UNDEFINED = ${marker}; const CASES = ${data};${runner}</script>`;
}

/** Writes `html` to a temporary page, loads it in headless Chrome and returns what it put in `#outcomes`. */
async function reportOf(html) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-highcharts-'));
	try {
		const file = join(directory, 'index.html');
		writeFileSync(file, html);
		const dumped = await dumpDom(pathToFileURL(file).href);
		const found = /<pre id="outcomes">([^<]*)<\/pre>/.exec(dumped);
		if (found === null) throw new Error('the Highcharts page did not report; a script failed to load');
		return JSON.parse(decodeURIComponent(found[1]));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

async function runPage(configs, modules, runner = RUNNER) {
	return reportOf(page(configs, modules, runner));
}

/**
 * Runs in the page. Creates a chart from each case's `create`, records the state `chart.update`
 * matches against (the series, their own and the chart's type, what `chart.get` finds for each id
 * in the update), applies `update` with `oneToOne`, and records which series each update item
 * reached and its type then, or `null` when it reached none. Items are told apart by their data:
 * item i carries `data: [MARK + i]`, and the runtime's own `Series#update` and `Chart#initSeries`
 * are observed (on this page only) to see which series received it.
 */
const UPDATES = `
const MARK = ${UPDATE_MARK};
const reached = [];
let recording = false;
const record = (options, series) => {
	const first = options && Array.isArray(options.data) ? options.data[0] : undefined;
	if (recording && typeof first === 'number' && first >= MARK) reached[first - MARK] = series;
};
const seriesUpdate = Highcharts.Series.prototype.update;
Highcharts.Series.prototype.update = function (options) {
	record(options, this);
	return seriesUpdate.apply(this, arguments);
};
// chart.update adds through the Chart#addSeries it captured, which creates through this.initSeries.
const initSeries = Highcharts.Chart.prototype.initSeries;
Highcharts.Chart.prototype.initSeries = function (options) {
	const series = initSeries.apply(this, arguments);
	record(options, series);
	return series;
};
const outcomes = [];
for (const { create, update, oneToOne } of CASES.map(revive)) {
	const container = document.createElement('div');
	container.style.cssText = 'width: 400px; height: 300px';
	document.body.append(container);
	const chart = Highcharts.chart(container, create);
	const items = update.series === undefined ? [] : [].concat(update.series);
	const found = {};
	for (const { id } of items.filter((item) => item && item.id != null)) {
		const item = chart.get(id);
		found[id] = item ? { coll: item.coll, index: chart.series.indexOf(item) } : null;
	}
	const state = {
		chartType: chart.options.chart.type,
		series: chart.series.map((series) => ({ type: series.type, own: series.userOptions.type, id: series.options.id, internal: series.options.isInternal === true })),
		found
	};
	reached.length = 0;
	recording = true;
	try {
		chart.update(update, true, oneToOne);
	} catch (error) {
		state.threw = error instanceof Error ? error.message : String(error);
	}
	recording = false;
	state.reached = items.map((_, index) => (reached[index] ? reached[index].type : null));
	chart.destroy();
	outcomes.push(state);
}
document.getElementById('outcomes').textContent = encodeURIComponent(JSON.stringify(outcomes));
`;

/**
 * Applies each `{ create, update, oneToOne }` (plain JSON; update series items get their data
 * marker here) to a chart of the pinned Highcharts in headless Chrome, and returns per case the
 * state matched against and the type each update item reached (`null`: none). See `UPDATES`.
 */
export function runHighchartsUpdates(cases) {
	for (const { create, update } of cases)
		if (!isJsonOrUndefined(create) || !isJsonOrUndefined(update)) throw new Error('a Highcharts update case must be plain JSON');
	const mark = (item, index) => ({ ...item, data: [UPDATE_MARK + index] });
	const marked = cases.map(({ update, ...rest }) => {
		const items = update.series;
		if (items === undefined) return { ...rest, update };
		return { ...rest, update: { ...update, series: Array.isArray(items) ? items.map(mark) : mark(items, 0) } };
	});
	return runPage(marked, ALWAYS, `${REVIVE}${UPDATES}`);
}

/**
 * Renders each `{ config, modules }` with the pinned Highcharts in headless Chrome and returns the
 * outcomes in order (`{ threw, messages }`, as the other runners). Cases that load the same
 * modules share one page; the configs must be plain JSON.
 */
export async function runHighcharts(cases) {
	for (const { config } of cases)
		if (!isJsonOrUndefined(config)) throw new Error('a Highcharts case must be plain JSON (explicit undefined allowed)');
	const groups = new Map();
	cases.forEach(({ modules = [] }, index) => {
		const key = [...ALWAYS, ...modules].join(' ');
		groups.set(key, [...(groups.get(key) ?? []), index]);
	});
	const outcomes = [];
	for (const [key, indices] of groups) {
		const results = await runPage(
			indices.map((index) => cases[index].config),
			key.split(' ')
		);
		indices.forEach((index, position) => (outcomes[index] = results[position]));
	}
	return outcomes;
}
