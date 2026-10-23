import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { dumpDom } from '../../shared/chrome.mjs';
import { isJson } from './json.mjs';

/** The development build of the pinned echarts, as for every runtime verdict. */
const BUNDLE = fileURLToPath(new URL('../../../node_modules/echarts/dist/echarts.js', import.meta.url));

/**
 * Runs in the page: each option is set on a chart of its own (SVG renderer, no animation), and what
 * assistive technology gets is recorded: the `aria-label` echarts writes on the container (`aria`),
 * and whether anything in the chart takes keyboard focus.
 */
const RUNNER = `
const outcomes = [];
for (const option of CASES) {
	const container = document.createElement('div');
	container.style.cssText = 'width: 400px; height: 300px';
	document.body.append(container);
	const outcome = {};
	try {
		const chart = echarts.init(container, null, { renderer: 'svg' });
		chart.setOption({ animation: false, ...option });
		outcome.label = container.getAttribute('aria-label') || '';
		outcome.keyboard = container.querySelector('[tabindex="0"]') !== null;
		chart.dispose();
	} catch (error) {
		outcome.threw = error instanceof Error ? error.message : String(error);
	}
	outcomes.push(outcome);
}
document.getElementById('outcomes').textContent = encodeURIComponent(JSON.stringify(outcomes));
`;

/**
 * Sets each option (plain JSON) on an echarts chart in headless Chrome and returns, in order,
 * `{ label, keyboard }`: the container's `aria-label` and whether anything takes keyboard focus.
 */
export async function runEchartsInBrowser(options) {
	for (const option of options) if (!isJson(option)) throw new Error('an echarts browser case must be plain JSON');
	const data = JSON.stringify(options).replaceAll('<', '\\u003c');
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-echarts-'));
	try {
		const file = join(directory, 'index.html');
		const script = `<script src="${pathToFileURL(BUNDLE).href}"></script>`;
		writeFileSync(
			file,
			`<!doctype html><meta charset="utf-8"><body>${script}<pre id="outcomes"></pre><script>const CASES = ${data};${RUNNER}</script>`
		);
		const html = await dumpDom(pathToFileURL(file).href);
		const found = /<pre id="outcomes">([^<]*)<\/pre>/.exec(html);
		if (found === null) throw new Error('the echarts page did not report; a script failed to load');
		return JSON.parse(decodeURIComponent(found[1]));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
