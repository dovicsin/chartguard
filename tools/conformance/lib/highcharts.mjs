import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dumpDom } from '../../shared/chrome.mjs';
import { isJsonOrUndefined } from './json.mjs';

const PACKAGE = fileURLToPath(new URL('../../../node_modules/highcharts/', import.meta.url));
/** Loaded on every page: Highcharts recommends it and warns on every chart rendered without it. */
const ALWAYS = ['accessibility'];
const MODULE_NAME = /^[\w-]+$/;
const UNDEFINED = '__chartguardUndefined';

/**
 * Runs in the page. Renders every option into its own container and records how Highcharts
 * reacted: what it reported through `displayError` (an error or a warning, also the ones its own
 * console de-duplication would hide after the first chart), other console output, and a throw.
 */
const RUNNER = `
const revive = (value) => {
	if (value === null || typeof value !== 'object') return value;
	if (value[UNDEFINED] === true) return undefined;
	for (const key of Object.keys(value)) value[key] = revive(value[key]);
	return value;
};
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
function page(configs, modules) {
	for (const name of modules) if (!MODULE_NAME.test(name)) throw new Error(`not a module name: ${name}`);
	const scripts = ['highcharts.src.js', ...modules.map((name) => `modules/${name}.src.js`)].map(scriptFor);
	// An explicit `undefined` travels as a marker the page turns back into `undefined`; `<` is
	// escaped so no option text can close the script element.
	const data = JSON.stringify(configs, (_, value) => (value === undefined ? { [UNDEFINED]: true } : value)).replaceAll('<', '\\u003c');
	const marker = JSON.stringify(UNDEFINED);
	return `<!doctype html><meta charset="utf-8"><body>${scripts.join('')}<pre id="outcomes"></pre><script>const UNDEFINED = ${marker}; const CASES = ${data};${RUNNER}</script>`;
}

async function runPage(configs, modules) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-highcharts-'));
	try {
		const file = join(directory, 'index.html');
		writeFileSync(file, page(configs, modules));
		const html = await dumpDom(pathToFileURL(file).href);
		const found = /<pre id="outcomes">([^<]*)<\/pre>/.exec(html);
		if (found === null) throw new Error('the Highcharts page did not report; a script failed to load');
		return JSON.parse(decodeURIComponent(found[1]));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
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
