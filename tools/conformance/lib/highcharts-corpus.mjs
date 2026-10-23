import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { verifiedUpstream } from '@chartguard/schema-generator';
import { build } from 'esbuild';

import { artifactPath } from '../../schema-generator/generate.mjs';
import { dumpDom } from '../../shared/chrome.mjs';
import { verdictOf } from './capture.mjs';
import { PACKAGE } from './highcharts.mjs';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** The schema this checkout generated from its own highcharts install, wherever the generator put it. */
const ARTIFACT = artifactPath(ROOT, verifiedUpstream(ROOT, 'highcharts'), 'highcharts');
const PAGE_SCRIPT = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g;
const CDN = /^https:\/\/code\.highcharts\.com\/((?:[\w-]+\/)*[\w.-]+)\.js$/;
/** How long a demo may keep rendering, in virtual milliseconds (animations, deferred work). */
const SETTLE = 300;

/** The pinned development build a demo page's CDN script stands for, or undefined. */
function localScript(url) {
	const match = CDN.exec(url);
	const path = match === null ? undefined : join(PACKAGE, `${match[1]}.src.js`);
	return path !== undefined && existsSync(path) ? pathToFileURL(path).href : undefined;
}

/**
 * Before the demo's scripts: record console output, uncaught errors and rejections. After
 * Highcharts loaded: record what it reports (`displayError`), and validate the options of every
 * chart the demo creates, in the parent page, before Highcharts sees them.
 */
const PROBE = `
window.__outcome = { charts: 0, findings: [], messages: [] };
const record = (channel, text) => {
	if (!__outcome.messages.some((message) => message.text === text)) __outcome.messages.push({ channel, text });
};
for (const channel of ['warn', 'error']) console[channel] = (...parts) => record(channel, parts.map(String).join(' '));
addEventListener('error', (event) => (__outcome.threw ??= String(event.message)));
addEventListener('unhandledrejection', (event) => (__outcome.threw ??= String(event.reason?.message ?? event.reason)));
`;
const WRAP = `
if (window.Highcharts !== undefined) {
	Highcharts.addEvent(Highcharts, 'displayError', (event) =>
		record(event.message.startsWith('Highcharts error') ? 'error' : 'warn', event.message));
	const validated = (args) => {
		const options = typeof args[0] === 'string' || args[0]?.nodeType === 1 ? args[1] : args[0];
		__outcome.charts += 1;
		__outcome.findings.push(...parent.__chartguardValidate(options));
	};
	for (const factory of ['chart', 'stockChart', 'mapChart', 'ganttChart']) {
		const original = Highcharts[factory];
		if (typeof original !== 'function') continue;
		Highcharts[factory] = function (...args) {
			validated(args);
			return original.apply(this, args);
		};
	}
	// \`new Highcharts.Chart(…)\`; the factories above construct through their own reference, never this one.
	Highcharts.Chart = new Proxy(Highcharts.Chart, {
		construct: (target, args, newTarget) => {
			validated(args);
			return Reflect.construct(target, args, newTarget);
		}
	});
}
`;

/** Script text that cannot close its own element. */
const inline = (code) => `<script>${code.replaceAll('</script', '<\\/script')}</script>`;

/** The demo as one document, its CDN scripts replaced by the pinned package; or the scripts it needs from elsewhere. */
function demoDocument({ code, page }) {
	const sources = [...page.matchAll(PAGE_SCRIPT)].map((match) => match[1]);
	const local = sources.map(localScript);
	const external = sources.filter((_, index) => local[index] === undefined);
	if (external.length > 0) return { external };
	const scripts = local.map((src) => `<script src="${src}"></script>`).join('');
	return {
		html: `<!doctype html><meta charset="utf-8">${inline(PROBE)}${scripts}${inline(WRAP)}${page.replace(PAGE_SCRIPT, '')}${inline(code)}`
	};
}

/** Runs in the parent page: one iframe per demo, one after the other, then the outcomes as text. */
const RUNNER = `
const report = (value) => (document.getElementById('outcomes').textContent = encodeURIComponent(JSON.stringify(value)));
let validator;
try {
	validator = chartguardCreateValidator(chartguardArtifact);
} catch (error) {
	report({ failure: String(error?.message ?? error) });
	throw error;
}
window.__chartguardValidate = (options) => validator(options).diagnostics.map((d) => d.severity + ' ' + d.code + ' ' + d.path);
const runDemo = (html) => new Promise((resolve) => {
	const frame = document.createElement('iframe');
	frame.style.cssText = 'width: 800px; height: 600px';
	frame.onload = () => setTimeout(() => {
		resolve(JSON.parse(JSON.stringify(frame.contentWindow.__outcome ?? { charts: 0, findings: [], messages: [] })));
		frame.remove();
	}, ${String(SETTLE)});
	frame.srcdoc = html;
	document.body.append(frame);
});
(async () => {
	const outcomes = [];
	for (const html of DEMOS) outcomes.push(await runDemo(html));
	report(outcomes);
})();
`;

async function validatorBundle() {
	const { outputFiles } = await build({
		stdin: {
			contents:
				"import { createValidator } from '@chartguard/config-highcharts'; globalThis.chartguardCreateValidator = createValidator;",
			resolveDir: ROOT,
			loader: 'js'
		},
		bundle: true,
		format: 'iife',
		platform: 'browser',
		write: false
	});
	return outputFiles[0].text;
}

function outcomeOf(path, prepared, ran) {
	if (prepared.external !== undefined)
		return { path, status: 'not-run', reason: `loads ${prepared.external.join(', ')}` };
	if (ran.charts === 0) return { path, status: 'not-run', reason: ran.threw ?? 'no chart was created' };
	return {
		path,
		status: 'ran',
		runtime: verdictOf(ran),
		findings: ran.findings,
		threw: ran.threw,
		messages: ran.messages
	};
}

/** Writes the corpus page, the validator bundle and the artifact next to each other; returns the page URL. */
async function writePage(directory, prepared) {
	writeFileSync(join(directory, 'validator.js'), await validatorBundle());
	writeFileSync(join(directory, 'artifact.js'), `globalThis.chartguardArtifact = ${readFileSync(ARTIFACT, 'utf8')};`);
	const demos = JSON.stringify(prepared.flatMap(({ html }) => (html === undefined ? [] : [html]))).replaceAll(
		'<',
		'\\u003c'
	);
	const page = `<!doctype html><meta charset="utf-8"><body><pre id="outcomes"></pre><script src="validator.js"></script><script src="artifact.js"></script><script>const DEMOS = ${demos};${RUNNER}</script>`;
	writeFileSync(join(directory, 'index.html'), page);
	return pathToFileURL(join(directory, 'index.html')).href;
}

/** The outcomes the page reported, in demo order. */
function reported(html) {
	const found = /<pre id="outcomes">([^<]*)<\/pre>/.exec(html);
	if (found === null || found[1] === '') throw new Error('the corpus page did not report');
	const ran = JSON.parse(decodeURIComponent(found[1]));
	if (!Array.isArray(ran)) throw new Error(`the corpus page failed: ${String(ran.failure)}`);
	return ran;
}

/**
 * Runs every demo of a local Highcharts corpus in one offline headless Chrome: each in its own
 * iframe with its own module set, its options validated by the locally generated schema, and the
 * runtime verdict taken from what Highcharts and the page reported. Upstream code runs only there.
 */
export async function runHighchartsCorpus(corpusPath) {
	const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
	const prepared = corpus.files.map(demoDocument);
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-highcharts-corpus-'));
	try {
		const ran = reported(await dumpDom(await writePage(directory, prepared), { offline: true, virtualTime: 600_000 }));
		let next = 0;
		return corpus.files.map(({ path }, index) =>
			outcomeOf(path, prepared[index], prepared[index].html === undefined ? undefined : ran[next++])
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
