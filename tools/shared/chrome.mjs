import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { skipOutsideCi } from './ci.mjs';

/** A Chrome or Chromium binary: `CHROME_PATH`, or the usual Linux locations. */
const CHROME = [
	process.env['CHROME_PATH'],
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser'
].find((path) => path !== undefined && existsSync(path));

/**
 * Why a browser test cannot run here, or undefined when it can. On CI a missing browser is a
 * failure, not a skip: a gate that silently skips is no gate.
 */
export function browserSkipReason() {
	return CHROME === undefined ? skipOutsideCi('needs Chrome (set CHROME_PATH)') : undefined;
}

/** Collects a child's output stream as text. */
function collect(stream) {
	let text = '';
	stream.on('data', (chunk) => (text += chunk));
	return () => text;
}

/**
 * The DOM of `url` after the page ran, in headless Chrome with virtual time. `offline` blocks every
 * host name lookup, for pages that run upstream code: nothing it does can reach the network. A
 * Chrome that exits with a failure rejects with its status and stderr: what it printed before is
 * a partial page, never a result. `binary` replaces the Chrome found here (tests).
 */
export function dumpDom(url, { offline = false, virtualTime = 120_000, binary = CHROME } = {}) {
	const sandbox = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
	const network = offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : [];
	const budget = `--virtual-time-budget=${String(virtualTime)}`;
	// Virtual time runs a page's self-test in seconds; Chrome would take its URL updates for a flood
	// (more than 200 navigations in 10 s) and drop them, a fragment change included.
	const flooding = '--disable-ipc-flooding-protection';
	// A sandboxed iframe gets a process of its own, whose tasks virtual time does not wait for: the
	// page would see its frames never answer. In the page's process, virtual time runs them too.
	const isolation = '--disable-features=IsolateSandboxedIframes';
	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-first-run',
		...sandbox,
		...network,
		budget,
		flooding,
		isolation,
		'--dump-dom',
		url
	];
	return new Promise((resolve, reject) => {
		const chrome = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const html = collect(chrome.stdout);
		const errors = collect(chrome.stderr);
		chrome.on('error', reject);
		chrome.on('close', (status, signal) => {
			if (status === 0) resolve(html());
			else reject(new Error(`Chrome exited with ${String(status ?? signal)} for ${url}:\n${errors()}`));
		});
	});
}
