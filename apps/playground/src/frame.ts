import * as chartjs from 'chart.js';
import * as echarts from 'echarts';

import { type DrawnLibrary, isRequest, type Reply, type Request } from './frame-protocol.js';
import { chartjsRenderer } from './render-chartjs.js';
import { echartsRenderer } from './render-echarts.js';
import { Capture, type Renderer } from './runtime.js';

/**
 * A drawing frame (CG-06-06 part 4): a sandboxed document with an opaque origin, a runtime of its own
 * and no network (its CSP). It takes one request from its parent, draws a config or runs code, and
 * answers once with what the runtime reported; the page then discards it. A runtime that prints a
 * message once per page (ECharts) prints it for every draw (E64).
 */

const RENDERERS: Readonly<Record<DrawnLibrary, Renderer>> = { chartjs: chartjsRenderer, echarts: echartsRenderer };

/** What the user's code may `require`: the bundled runtimes, as an ES module namespace. */
const MODULES: Readonly<Record<string, unknown>> = {
	'chart.js': { __esModule: true, ...chartjs, default: chartjs.Chart },
	// Chart.js' own entry that registers everything; it is registered here already.
	'chart.js/auto': { __esModule: true, ...chartjs, default: chartjs.Chart },
	// The time-scale adapter the frame installs already.
	'chartjs-adapter-date-fns': { __esModule: true },
	echarts: { __esModule: true, ...echarts, default: echarts }
};

function requireBundled(name: string): unknown {
	if (Object.hasOwn(MODULES, name)) return MODULES[name];
	throw new Error(`"${name}" is not bundled in the playground: it runs Chart.js and ECharts`);
}

/** Runs CommonJS code (the user's source, transpiled by the page) with the bundled runtimes. */
function run(code: string): void {
	const module = { exports: {} };
	// The sandbox's purpose: the page never evaluates, and this frame has an opaque origin, no network.
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const body = new Function('require', 'module', 'exports', code) as (
		require: (name: string) => unknown,
		module: { exports: object },
		exports: object
	) => void;
	body(requireBundled, module, module.exports);
}

function perform(request: Request, stage: HTMLElement): void {
	if (request.kind === 'code') run(request.code);
	else RENDERERS[request.library].render(stage, request.config);
}

/** Resolves after the tasks a draw started have run (a runtime's resize timer): an order of events, never a time limit. */
const settled = (): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(() => setTimeout(resolve, 0), 0);
	});

function listen(): void {
	const uncaught: string[] = [];
	window.addEventListener('error', (event) => {
		uncaught.push(event.message);
	});
	window.addEventListener('unhandledrejection', (event) => {
		uncaught.push(String(event.reason));
	});
	// What the frame's CSP refused (the network, a script from elsewhere), when it is reported in time.
	document.addEventListener('securitypolicyviolation', (event) => {
		uncaught.push(`the sandbox blocked ${event.blockedURI} (${event.effectiveDirective})`);
	});
	let answered = false;
	window.addEventListener('message', (event) => {
		if (answered || event.source !== window.parent || !isRequest(event.data)) return;
		answered = true;
		const request = event.data;
		const capture = new Capture();
		const stage = document.getElementById('stage') ?? document.body;
		capture.run(() => {
			perform(request, stage);
		});
		void settled().then(() => {
			const reply: Reply = { kind: 'outcome', verdict: capture.verdict(), messages: capture.messages(), uncaught };
			// The parent's origin is not this frame's to know (opaque); the reply holds nothing secret.
			window.parent.postMessage(reply, '*');
		});
	});
	window.parent.postMessage({ kind: 'ready' } satisfies Reply, '*');
}

listen();
