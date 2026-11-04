import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dumpDom } from '../chrome.mjs';

/** A stand-in for Chrome: prints `stdout` and `stderr`, then exits with `status`. */
function fakeChrome(t, { stdout, stderr, status }) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-chrome-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const binary = join(directory, 'chrome');
	writeFileSync(binary, `#!/bin/sh\nprintf '%s' '${stdout}'\nprintf '%s' '${stderr}' >&2\nexit ${String(status)}\n`);
	chmodSync(binary, 0o755);
	return binary;
}

/** Whether `pid` runs: it exists and, where Linux says so, is not a zombie (killed, not yet reaped). */
function alive(pid) {
	try {
		process.kill(pid, 0);
	} catch (error) {
		if (error.code === 'ESRCH') return false;
		throw error;
	}
	try {
		return !/^\d+ \(.*\) Z/su.test(readFileSync(`/proc/${String(pid)}/stat`, 'utf8'));
	} catch {
		return true;
	}
}

/**
 * Whether `pid` stops running. A killed process is gone once it is reaped (as a zombie it no longer
 * runs): under load that can follow its parent's exit by a while. Counted, never timed: at most 500
 * checks of 10 ms.
 */
async function stopped(pid) {
	for (let check = 0; check < 500; check += 1) {
		if (!alive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return false;
}

const posix = { skip: process.platform === 'win32' ? 'needs a POSIX shell' : false };

test('a page Chrome dumped completely is returned', posix, async (t) => {
	const binary = fakeChrome(t, { stdout: '<html></html>', stderr: '', status: 0 });
	assert.equal(await dumpDom('http://127.0.0.1/', { binary }), '<html></html>');
});

test('a Chrome that fails is a failure with its status and stderr, never partial HTML', posix, async (t) => {
	const binary = fakeChrome(t, { stdout: '<html><body>half', stderr: 'crashed: out of memory', status: 3 });
	await assert.rejects(dumpDom('http://127.0.0.1/', { binary }), /exited with 3.*crashed: out of memory/s);
});

/** A stand-in for Chrome that writes into the profile it is given and says where it was. */
function profileChrome(t, status) {
	const directory = mkdtempSync(join(tmpdir(), 'chartguard-chrome-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const binary = join(directory, 'chrome');
	const script = [
		'#!/bin/sh',
		'for arg in "$@"; do case "$arg" in --user-data-dir=*) dir="${arg#--user-data-dir=}";; esac; done',
		'[ -n "$dir" ] || exit 9',
		'mkdir -p "$dir/Default/Cache" && printf x > "$dir/Default/Cache/data"',
		'printf \'%s\' "$dir"',
		`exit ${String(status)}`
	].join('\n');
	writeFileSync(binary, `${script}\n`);
	chmodSync(binary, 0o755);
	return binary;
}

test('each Chrome gets a profile of its own, removed after it exits, however it exits (E76)', posix, async (t) => {
	// Without one, headless Chrome leaves a profile with its cache under ~/.cache for every run. The
	// profiles are looked for in a temporary directory of this test's own: other test files run
	// browsers at the same time, each with its profile in the shared one.
	const binaries = [profileChrome(t, 0), profileChrome(t, 3)];
	const own = mkdtempSync(join(tmpdir(), 'chartguard-chrome-tmp-'));
	const previous = process.env['TMPDIR'];
	process.env['TMPDIR'] = own;
	t.after(() => {
		if (previous === undefined) delete process.env['TMPDIR'];
		else process.env['TMPDIR'] = previous;
		rmSync(own, { recursive: true, force: true });
	});
	const profile = await dumpDom('http://127.0.0.1/', { binary: binaries[0] });
	assert.ok(profile.startsWith(join(own, 'chartguard-chrome-profile-')), profile);
	assert.equal(existsSync(profile), false, 'removed after a run');
	await assert.rejects(dumpDom('http://127.0.0.1/', { binary: binaries[1] }), /exited with 3/u);
	assert.deepEqual(readdirSync(own), [], 'removed after a failure');
	await assert.rejects(dumpDom('http://127.0.0.1/', { binary: join(own, 'no-such-chrome') }));
	assert.deepEqual(readdirSync(own), [], 'removed when Chrome does not start');
});

test('a process that exits while its Chrome runs stops it and removes its profile (E76)', posix, async (t) => {
	// Under a full parallel check a test process can end before its Chrome closes: the profile stayed.
	const own = mkdtempSync(join(tmpdir(), 'chartguard-chrome-tmp-'));
	t.after(() => rmSync(own, { recursive: true, force: true }));
	const binary = join(own, 'chrome');
	const marker = join(own, 'started');
	writeFileSync(
		binary,
		`#!/bin/sh\nprintf '%s' "$$" > '${marker}.tmp' && mv '${marker}.tmp' '${marker}'\nexec sleep 30\n`
	);
	chmodSync(binary, 0o755);
	const chrome = fileURLToPath(new URL('../chrome.mjs', import.meta.url));
	const script = [
		`import { existsSync } from 'node:fs';`,
		`const { dumpDom } = await import(${JSON.stringify(chrome)});`,
		`dumpDom('http://127.0.0.1/', { binary: ${JSON.stringify(binary)} }).catch(() => {});`,
		// Counted, never timed: at most 500 checks of 10 ms for the stand-in to start.
		`for (let i = 0; i < 500 && !existsSync(${JSON.stringify(marker)}); i++) await new Promise((r) => setTimeout(r, 10));`,
		'process.exit(0);'
	].join('\n');
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		env: { ...process.env, TMPDIR: own },
		encoding: 'utf8',
		timeout: 60_000
	});
	assert.equal(run.status, 0, run.stderr);
	const pid = Number(readFileSync(marker, 'utf8'));
	assert.deepEqual(
		readdirSync(own).filter((name) => name.startsWith('chartguard-chrome-profile-')),
		[]
	);
	assert.equal(await stopped(pid), true, 'the stand-in Chrome was stopped');
});

test('runs one after another leave no exit listener behind (E76)', posix, async (t) => {
	const binary = fakeChrome(t, { stdout: '<html></html>', stderr: '', status: 0 });
	const before = process.listenerCount('exit');
	for (let run = 0; run < 12; run += 1) await dumpDom('http://127.0.0.1/', { binary });
	assert.equal(process.listenerCount('exit'), before);
});
