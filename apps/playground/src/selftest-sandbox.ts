import { Frames } from './frames.js';
import type { Page } from './selftest-page.js';

/** A source the static checks read only in part (a callback), and what it draws when run. */
const CALLBACK = `import * as echarts from 'echarts';

const chart = echarts.init(document.getElementById('chart'));
chart.setOption({
	xAxis: { type: 'category', data: ['a', 'b'] },
	yAxis: {},
	series: [{ type: 'bar', data: [1, 2], label: { show: true, formatter: (point) => \`\${point.value} units\` } }]
});
`;

/** Sources the sandbox must contain: each one's run is rejected, with a message that says why. */
const CONTAINED: readonly { readonly name: string; readonly code: string; readonly says: RegExp }[] = [
	{ name: 'a throw', code: "throw new Error('boom');", says: /boom/u },
	{
		name: 'a library not bundled',
		code: "import Highcharts from 'highcharts';\nHighcharts.chart('container', {});",
		says: /"highcharts" is not bundled/u
	},
	{
		name: 'the parent page',
		code: 'const title = window.parent.document.title;',
		says: /cross-origin|Blocked a frame/u
	},
	{ name: 'storage', code: "localStorage.setItem('a', '1');", says: /localStorage|denied|sandboxed/u },
	{ name: 'a name of the prototype', code: "require('constructor');", says: /"constructor" is not bundled/u },
	{
		name: 'a malformed answer of its own',
		code: "window.parent.postMessage({ kind: 'outcome', verdict: 'accepted' }, '*');\nthrow new Error('the real one');",
		says: /the real one/u
	}
];

/** Code that asks for itself again (a forged `ready`): it runs once, the frame answers once. */
const AGAIN =
	"window.parent.postMessage({ kind: 'ready' }, '*');\nglobalThis.runs = (globalThis.runs ?? 0) + 1;\nconsole.warn('run ' + String(globalThis.runs));";

/** One source run in the sandbox: its verdict and what the runtime reported (messages and frame errors). */
async function ran(page: Page, text: string): Promise<{ readonly verdict: string | undefined; readonly said: string }> {
	page.showText(text);
	await page.drawn();
	await page.run();
	return { verdict: page.shown().runtime, said: [...page.runtimeMessages(), ...page.frameErrors()].join('\n') };
}

/**
 * What a frame answers is taken from that frame only, once: a message the page posts itself in the
 * shape of an answer is ignored; code that asks to run again runs once; an error a timer throws after
 * the run is reported.
 */
async function answerProblems(page: Page): Promise<string[]> {
	const problems: string[] = [];
	page.showText("throw new Error('drawn');");
	await page.drawn();
	const running = page.run();
	window.postMessage({ kind: 'outcome', verdict: 'accepted', messages: ['forged'], uncaught: [] }, '*');
	await running;
	if (page.shown().runtime !== 'rejected' || page.runtimeMessages().includes('forged'))
		problems.push(`a forged answer was taken: ${String(page.shown().runtime)} ${page.runtimeMessages().join(' ')}`);
	const again = await ran(page, AGAIN);
	if (again.said !== 'run 1') problems.push(`code that asks again ran: "${again.said}"`);
	const later = await ran(page, "setTimeout(() => { throw new Error('later'); }, 0);");
	if (!later.said.includes('later')) problems.push(`an error thrown later was lost: "${later.said}"`);
	return problems;
}

/**
 * The hang guard: a frame that never answers (a page without the frame's script stands in for an
 * endless loop, which in this harness would stop the page too: its frames share its process) is
 * removed and its draw reported unfinished.
 */
async function guardProblems(): Promise<string[]> {
	const host = document.createElement('div');
	document.body.append(host);
	const outcome = await new Frames(host, './frame.css', 1000).draw({ kind: 'code', code: '' });
	const problems = outcome?.verdict === 'unfinished' ? [] : [`a silent frame gave ${JSON.stringify(outcome)}`];
	if (host.childElementCount > 0) problems.push('the guard left the silent frame in the page');
	// A guard that outlives its draw removes nothing: a frame that answered stays.
	const answered = await new Frames(host, './frame.html', 1000).draw({ kind: 'code', code: '' });
	await new Promise((resolve) => {
		setTimeout(resolve, 1500);
	});
	if (answered?.verdict !== 'accepted' || host.childElementCount !== 1)
		problems.push(`after its guard's time, an answered frame is ${host.childElementCount === 1 ? 'there' : 'gone'}`);
	host.remove();
	return problems;
}

/**
 * The opt-in run (CG-06-06 part 4): a source with a callback, not drawn from the static read, draws
 * when run; what the sandbox must contain (throws, unbundled libraries, the parent page, storage, the
 * network) is rejected with the reason, and the page stays one frame.
 */
export async function sandboxProblems(page: Page): Promise<string[]> {
	const problems: string[] = [];
	await page.select('echarts', 'javascript');
	page.showText(CALLBACK);
	await page.drawn();
	if (page.shown().runtime !== undefined)
		problems.push(`a config read in part was drawn: ${String(page.shown().runtime)}`);
	await page.run();
	if (page.shown().runtime !== 'accepted')
		problems.push(`the source with a callback ran ${String(page.shown().runtime)}`);
	if (!page.runtimeNote().startsWith('Ran the source in a sandbox')) problems.push('a run without its note');
	for (const { name, code, says } of CONTAINED) {
		const { verdict, said } = await ran(page, code);
		if (verdict !== 'rejected' || !says.test(said)) problems.push(`${name}: ${String(verdict)} "${said}"`);
	}
	// A synchronous request fails in the run itself; `fetch` would reject after the frame answered.
	const network = await ran(
		page,
		"const request = new XMLHttpRequest();\nrequest.open('GET', 'https://example.com/', false);\nrequest.send();"
	);
	if (network.verdict !== 'rejected' || !/send|Network|Content Security Policy|blocked/u.test(network.said))
		problems.push(`the network: ${String(network.verdict)} "${network.said}"`);
	if (page.frames() !== 1) problems.push(`the page holds ${String(page.frames())} frames`);
	return [...problems, ...(await answerProblems(page)), ...(await guardProblems())];
}
