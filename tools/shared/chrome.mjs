import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** The Chromes still running, by their profile: stopped and removed if this process exits first. */
const running = new Map();

/** Stops every Chrome still running and removes its profile (an exit handler: synchronous only). */
function stopRunning() {
	for (const [profile, chrome] of running) {
		chrome.kill('SIGKILL');
		rmSync(profile, { recursive: true, force: true });
	}
	running.clear();
}

/** Starts Chrome and records it as running; a Chrome that cannot start removes its profile. */
function start(binary, args, profile, removeProfile) {
	let chrome;
	try {
		chrome = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (error) {
		removeProfile();
		throw error;
	}
	if (running.size === 0) process.once('exit', stopRunning);
	running.set(profile, chrome);
	return chrome;
}

/** Collects a child's output stream as text. */
function collect(stream) {
	let text = '';
	stream.on('data', (chunk) => (text += chunk));
	return () => text;
}

/** The command line of a headless Chrome that dumps the DOM of `url`, with its profile in `profile`. */
function chromeArgs(url, profile, { offline, virtualTime, colorScheme }) {
	const sandbox = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
	const network = offline ? ['--host-resolver-rules=MAP * ~NOTFOUND'] : [];
	const budget = `--virtual-time-budget=${String(virtualTime)}`;
	// What `prefers-color-scheme` answers (Blink: 0 dark, 1 light), without darkening the page itself.
	const scheme = `--blink-settings=preferredColorScheme=${colorScheme === 'dark' ? '0' : '1'}`;
	// Virtual time runs a page's self-test in seconds; Chrome would take its URL updates for a flood
	// (more than 200 navigations in 10 s) and drop them, a fragment change included.
	const flooding = '--disable-ipc-flooding-protection';
	// A sandboxed iframe gets a process of its own, whose tasks virtual time does not wait for: the
	// page would see its frames never answer. In the page's process, virtual time runs them too.
	const isolation = '--disable-features=IsolateSandboxedIframes';
	return [
		'--headless=new',
		'--disable-gpu',
		'--no-first-run',
		`--user-data-dir=${profile}`,
		...sandbox,
		...network,
		budget,
		scheme,
		flooding,
		isolation,
		'--dump-dom',
		url
	];
}

/**
 * The DOM of `url` after the page ran, in headless Chrome with virtual time. `offline` blocks every
 * host name lookup, for pages that run upstream code: nothing it does can reach the network. A
 * Chrome that exits with a failure rejects with its status and stderr: what it printed before is
 * a partial page, never a result. `colorScheme` (`light` or `dark`) is what the page's
 * `prefers-color-scheme` answers. `binary` replaces the Chrome found here (tests). Each Chrome runs
 * in a profile of its own, removed when it exits however it exits: without one, headless Chrome
 * leaves a profile with its cache under ~/.cache for every run (E76). A process that exits while its
 * Chrome runs stops it and removes the profile.
 */
export function dumpDom(url, { offline = false, virtualTime = 120_000, binary = CHROME, colorScheme = 'light' } = {}) {
	const profile = mkdtempSync(join(tmpdir(), 'chartguard-chrome-profile-'));
	const removeProfile = () => {
		running.delete(profile);
		// The exit handler is there only while a Chrome runs: runs one after another add none each.
		if (running.size === 0) process.off('exit', stopRunning);
		rmSync(profile, { recursive: true, force: true });
	};
	const args = chromeArgs(url, profile, { offline, virtualTime, colorScheme });
	return new Promise((resolve, reject) => {
		const chrome = start(binary, args, profile, removeProfile);
		const html = collect(chrome.stdout);
		const errors = collect(chrome.stderr);
		chrome.on('error', (error) => {
			removeProfile();
			reject(error);
		});
		chrome.on('close', (status, signal) => {
			removeProfile();
			if (status === 0) resolve(html());
			else reject(new Error(`Chrome exited with ${String(status ?? signal)} for ${url}:\n${errors()}`));
		});
	});
}
