import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/** A Chrome or Chromium binary: `CHROME_PATH`, or the usual Linux locations. */
const CHROME = [process.env['CHROME_PATH'], '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(
	(path) => path !== undefined && existsSync(path)
);

/**
 * Why a browser test cannot run here, or undefined when it can. On CI a missing browser is a
 * failure, not a skip: a gate that silently skips is no gate.
 */
export function browserSkipReason() {
	if (CHROME !== undefined) return undefined;
	if (process.env['CI'] !== undefined) throw new Error('CI must provide Chrome (set CHROME_PATH) for the browser tests');
	return 'needs Chrome (set CHROME_PATH)';
}

/**
 * The DOM of `url` after the page ran, in headless Chrome with virtual time. `offline` blocks every
 * host name lookup, for pages that run upstream code: nothing it does can reach the network.
 */
export function dumpDom(url, { offline = false, virtualTime = 120_000 } = {}) {
	const sandbox = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
	const network = offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : [];
	const budget = `--virtual-time-budget=${String(virtualTime)}`;
	const args = ['--headless=new', '--disable-gpu', '--no-first-run', ...sandbox, ...network, budget, '--dump-dom', url];
	return new Promise((resolve, reject) => {
		const chrome = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		let html = '';
		chrome.stdout.on('data', (chunk) => (html += chunk));
		chrome.on('error', reject);
		chrome.on('close', () => resolve(html));
	});
}
