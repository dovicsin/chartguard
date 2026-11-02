import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

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

const posix = { skip: process.platform === 'win32' ? 'needs a POSIX shell' : false };

test('a page Chrome dumped completely is returned', posix, async (t) => {
	const binary = fakeChrome(t, { stdout: '<html></html>', stderr: '', status: 0 });
	assert.equal(await dumpDom('http://127.0.0.1/', { binary }), '<html></html>');
});

test('a Chrome that fails is a failure with its status and stderr, never partial HTML', posix, async (t) => {
	const binary = fakeChrome(t, { stdout: '<html><body>half', stderr: 'crashed: out of memory', status: 3 });
	await assert.rejects(dumpDom('http://127.0.0.1/', { binary }), /exited with 3.*crashed: out of memory/s);
});
