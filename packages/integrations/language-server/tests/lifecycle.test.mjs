import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { connect, frame } from './client.mjs';

/** What the server does around its documents: malformed notifications, the lifecycle, setup problems said once. */
const CHART = "import { Chart } from 'chart.js';\n";
const WRONG = `${CHART}new Chart(ctx, { type: 'bar', data: { datasets: [] }, options: { scales: { y: { min: 'x' } } } });`;
const uri = (name) => pathToFileURL(join(process.cwd(), name)).href;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const published = (client, target) =>
	client.notifications.filter(
		({ method, params }) => method === 'textDocument/publishDiagnostics' && params.uri === target
	);

test('a malformed notification is logged, never a crash: the server serves on', async () => {
	const client = connect();
	await client.initialize();
	await client.open(uri('chart.js'), WRONG);
	client.notify('textDocument/didChange', { textDocument: { uri: uri('chart.js'), version: 2 }, contentChanges: {} });
	const logged = await client.next('window/logMessage');
	assert.equal(logged.params.type, 1);
	assert.match(logged.params.message, /^ChartGuard could not handle textDocument\/didChange: /u);
	// A change without text changes nothing; the server serves on.
	client.notify('textDocument/didChange', { textDocument: { uri: uri('chart.js'), version: 3 }, contentChanges: [] });
	assert.equal(client.notifications.filter(({ method }) => method === 'window/logMessage').length, 0);
	const { result } = await client.request('textDocument/codeAction', {
		textDocument: { uri: uri('chart.js') },
		range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
		context: { diagnostics: [] }
	});
	assert.deepEqual(result, []);
	assert.equal((await client.request('shutdown')).result, null);
});

test('a change the server cannot apply leaves the text unknown: its findings are withdrawn until it is opened again', async () => {
	const at = (line, character) => ({ line, character });
	for (const change of [
		{ range: { start: at(0, 0) }, text: '' },
		{ range: { start: at(0, 1), end: at(0, 0) }, text: '' },
		{ range: { start: at(-1, 0), end: at(0, 0) }, text: '' },
		{ range: { start: at(0, 0.5), end: at(0, 1) }, text: '' },
		{ range: { start: at(0, 0), end: at(0, 0) } },
		null
	]) {
		const client = connect();
		await client.initialize();
		await client.open(uri('chart.js'), WRONG);
		client.notify('textDocument/didChange', {
			textDocument: { uri: uri('chart.js'), version: 2 },
			contentChanges: [{ range: { start: at(0, 0), end: at(0, 0) }, text: '// ok\n' }, change]
		});
		assert.deepEqual((await client.next('textDocument/publishDiagnostics')).params, {
			uri: uri('chart.js'),
			diagnostics: []
		});
		assert.match((await client.next('window/logMessage')).params.message, /could not handle textDocument\/didChange/u);
		// A later change finds no document: the editor's text is no longer known.
		client.notify('textDocument/didChange', {
			textDocument: { uri: uri('chart.js'), version: 3 },
			contentChanges: [{ text: WRONG }]
		});
		// A check it scheduled would publish before that of a document opened after it, with the same wait.
		await client.open(uri('other.js'), WRONG);
		assert.deepEqual(published(client, uri('chart.js')), [], JSON.stringify(change));
		const reopened = await client.open(uri('chart.js'), WRONG);
		assert.equal(reopened.params.diagnostics.length, 1);
	}
});

test('responses from the client are not requests; after exit nothing is answered', async () => {
	const client = connect();
	await client.initialize();
	client.raw(frame({ jsonrpc: '2.0', id: 99, result: null }));
	await settle();
	assert.deepEqual(
		client.notifications.filter(({ error }) => error !== undefined),
		[]
	);
	client.notify('exit');
	await settle();
	client.raw(frame({ jsonrpc: '2.0', id: 5, method: 'shutdown' }));
	await settle();
	assert.deepEqual(
		client.notifications.filter(({ id }) => id === 5),
		[]
	);
});

test('documents opened before initialize are not kept; a document scheduled at shutdown is not published', async () => {
	const early = connect();
	early.notify('textDocument/didOpen', {
		textDocument: { uri: uri('early.js'), languageId: 'javascript', version: 1, text: WRONG }
	});
	await early.initialize();
	early.notify('workspace/didChangeConfiguration', { settings: { chartguard: {} } });
	const first = await early.open(uri('later.js'), WRONG);
	assert.equal(first.params.uri, uri('later.js'));
	assert.deepEqual(published(early, uri('early.js')), []);
	const late = connect({ delay: 30 });
	await late.initialize();
	late.notify('textDocument/didOpen', {
		textDocument: { uri: uri('late.js'), languageId: 'javascript', version: 1, text: WRONG }
	});
	await late.request('shutdown');
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.deepEqual(published(late, uri('late.js')), []);
});

test('a setup problem met while checking is shown once, and again after the settings changed', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'chartguard-lsp-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const auto = { chartguard: { libraryVersion: { chartjs: 'auto' } } };
	const client = connect();
	await client.initialize({ rootUri: pathToFileURL(root).href, initializationOptions: { settings: auto } });
	await client.open('untitled:One', WRONG);
	await client.open('untitled:Two', WRONG);
	const shown = client.notifications.filter(({ method }) => method === 'window/showMessage');
	assert.equal(shown.length, 1);
	assert.match(
		shown[0].params.message,
		/chartguard\.libraryVersion\.chartjs: "auto", but chart\.js is not installed for /u
	);
	client.notify('workspace/didChangeConfiguration', { settings: auto });
	await client.next('textDocument/publishDiagnostics');
	assert.equal(client.notifications.filter(({ method }) => method === 'window/showMessage').length, 2);
});
