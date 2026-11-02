import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { frame } from './client.mjs';

/** The bin on stdio, as an editor starts it: stdout carries only protocol messages, and `exit` ends the process. */
const BIN = fileURLToPath(new URL('../bin/chartguard-language-server.mjs', import.meta.url));

test('the bin speaks LSP on stdio and exits 0 after shutdown and exit', async () => {
	const child = spawn(process.execPath, [BIN, '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
	let out = '';
	let err = '';
	child.stdout.on('data', (chunk) => (out += chunk));
	child.stderr.on('data', (chunk) => (err += chunk));
	const exited = new Promise((resolve) => child.on('exit', resolve));
	child.stdin.write(
		frame({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } })
	);
	child.stdin.write(frame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }));
	child.stdin.write(frame({ jsonrpc: '2.0', method: 'exit' }));
	assert.equal(await exited, 0);
	assert.equal(err, '');
	const bodies = out
		.split(/Content-Length: \d+\r\n\r\n/u)
		.filter(Boolean)
		.map((body) => JSON.parse(body));
	assert.deepEqual(
		bodies.map(({ id }) => id),
		[1, 2]
	);
	assert.equal(bodies[0].result.serverInfo.name, 'chartguard-language-server');
});
