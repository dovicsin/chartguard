import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { connect, frame } from './client.mjs';

/** The language server (CG-06-04 part 2): diagnostics as documents open and change, code actions, the protocol's rules. */
const CHART = "import { Chart } from 'chart.js';\n";
const WRONG = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
const uri = (name) => pathToFileURL(join(process.cwd(), name)).href;
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('initialize: full text sync, quick fixes, and the server named as its package', async () => {
	const client = connect();
	const { result } = await client.initialize();
	assert.deepEqual(result, {
		capabilities: {
			textDocumentSync: { openClose: true, change: 1 },
			codeActionProvider: { codeActionKinds: ['quickfix'] }
		},
		serverInfo: { name: 'chartguard-language-server', version: manifest.version }
	});
});

test('an opened document gets its findings at LSP positions; a changed one again; a closed one none', async () => {
	const client = connect();
	await client.initialize();
	const opened = await client.open(uri('chart.js'), WRONG);
	const column = WRONG.split('\n')[1].indexOf("'x'");
	assert.deepEqual(opened.params, {
		uri: uri('chart.js'),
		version: 1,
		diagnostics: [
			{
				range: { start: { line: 1, character: column }, end: { line: 1, character: column + 3 } },
				severity: 1,
				source: 'ChartGuard',
				code: 'valid-config',
				message: 'CFG_TYPE $.options.scales.y.min: Expected number | function, got string.'
			}
		]
	});
	client.notify('textDocument/didChange', {
		textDocument: { uri: uri('chart.js'), version: 2 },
		contentChanges: [{ text: WRONG.replace("'x'", '0') }]
	});
	assert.deepEqual((await client.next('textDocument/publishDiagnostics')).params, {
		uri: uri('chart.js'),
		version: 2,
		diagnostics: []
	});
	client.notify('textDocument/didClose', { textDocument: { uri: uri('chart.js') } });
	assert.deepEqual((await client.next('textDocument/publishDiagnostics')).params, {
		uri: uri('chart.js'),
		diagnostics: []
	});
});

test('positions count lines as LSP does (\\n, \\r\\n, \\r), not as TypeScript does (also U+2028, U+2029)', async () => {
	const client = connect();
	await client.initialize();
	const text = `${CHART}/* a\u2028b\u2029c */ new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const { params } = await client.open(uri('chart.js'), text);
	const line = text.split('\n')[1];
	assert.deepEqual(params.diagnostics[0].range.start, { line: 1, character: line.indexOf("'x'") });
	const crlf = `${CHART.replace('\n', '\r\n')}\rnew Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
	const second = await client.open(uri('other.js'), crlf);
	assert.equal(second.params.diagnostics[0].range.start.line, 2);
});

test('severities: errors, warnings, and quality findings as information', async () => {
	const client = connect();
	await client.initialize();
	const text = `${CHART}new Chart(ctx, { type: 'bar', data: { labels: ['a'], datasets: [{ label: 'S', data: [10] }] }, options: { responsiv: true, scales: { y: { min: 5, title: { display: true, text: 'Count' } } } } });`;
	const { params } = await client.open(uri('chart.js'), text);
	assert.deepEqual(
		params.diagnostics.map(({ code, severity }) => [code, severity]),
		[
			['config-warnings', 2],
			['chart-quality', 3]
		]
	);
});

/** The next message carrying an error with `code`, among those that are not responses to a request. */
const errorReply = (client, code) =>
	new Promise((resolve) => {
		const timer = setInterval(() => {
			const found = client.notifications.find((message) => message.error?.code === code);
			if (found !== undefined) {
				clearInterval(timer);
				resolve(found);
			}
		}, 5);
	});

test('the protocol: requests before initialize, unknown methods, malformed JSON', async () => {
	const early = connect();
	assert.equal((await early.request('textDocument/codeAction', {})).error.code, -32002);
	const client = connect();
	await client.initialize();
	assert.deepEqual((await client.request('workspace/symbol', { query: '' })).error, {
		code: -32601,
		message: 'Unhandled method workspace/symbol'
	});
	client.raw(Buffer.concat([Buffer.from('Content-Length: 9\r\n\r\n', 'ascii'), Buffer.from('{ broken ', 'utf8')]));
	assert.deepEqual(await errorReply(client, -32700), {
		jsonrpc: '2.0',
		id: null,
		error: { code: -32700, message: 'Parse error' }
	});
	client.raw(frame([1, 2]));
	assert.equal((await errorReply(client, -32600)).id, null);
	// Still serving after malformed messages.
	assert.equal((await client.request('shutdown')).result, null);
});

test('shutdown then exit ends with 0; exit without shutdown with 1; nothing is answered after shutdown', async () => {
	const client = connect();
	await client.initialize();
	assert.equal((await client.request('shutdown')).result, null);
	assert.equal((await client.request('textDocument/codeAction', {})).error.code, -32600);
	client.notify('exit');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(client.exits, [0]);
	const abrupt = connect();
	await abrupt.initialize();
	abrupt.notify('exit');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(abrupt.exits, [1]);
});

test('a message larger than the server reads, or without a length, ends the connection with the reason', async () => {
	const client = connect();
	await client.initialize();
	client.raw(Buffer.from(`Content-Length: ${String(64 * 1024 * 1024)}\r\n\r\n`, 'ascii'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(client.exits, [1]);
	const headless = connect();
	headless.raw(Buffer.from('Content-Type: x\r\n\r\n{}', 'ascii'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(headless.exits, [1]);
	assert.ok(frame({}).length > 0);
});
