import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { fileNameOf } from '../dist/documents.js';
import { Lines, overlaps } from '../dist/positions.js';
import { annotationsOf, rootOf } from '../dist/protocol.js';
import { connect, frame } from './client.mjs';

/** The pieces the protocol tests reach only in part: positions, ranges, names and roots. */
test('positions: a line starts after \\n, \\r\\n or \\r, and an offset at a line start is on that line', () => {
	const lines = new Lines('ab\ncd\r\nef\rg\u2028h');
	const at = (offset) => lines.positionOf(offset);
	assert.deepEqual([0, 2, 3, 5, 7, 9, 10, 12].map(at), [
		{ line: 0, character: 0 },
		{ line: 0, character: 2 },
		{ line: 1, character: 0 },
		{ line: 1, character: 2 },
		{ line: 2, character: 0 },
		{ line: 2, character: 2 },
		{ line: 3, character: 0 },
		{ line: 3, character: 2 }
	]);
});

test('ranges overlap when they share a position, on one line or across lines', () => {
	const range = (a, b, c, d) => ({ start: { line: a, character: b }, end: { line: c, character: d } });
	assert.equal(overlaps(range(0, 0, 0, 5), range(0, 5, 0, 9)), true);
	assert.equal(overlaps(range(0, 0, 0, 4), range(0, 5, 0, 9)), false);
	assert.equal(overlaps(range(0, 6, 0, 9), range(0, 0, 0, 5)), false);
	assert.equal(overlaps(range(1, 0, 3, 0), range(2, 4, 2, 6)), true);
	assert.equal(overlaps(range(2, 7, 3, 0), range(2, 4, 2, 6)), false);
});

test('a document is checked under its path, or an unsaved one under its name in the workspace with its language', () => {
	const root = join('/work', 'space');
	const file = join('/elsewhere', 'src', 'chart.ts');
	assert.equal(fileNameOf(pathToFileURL(file).href, 'typescript', root), file);
	assert.equal(fileNameOf('untitled:Untitled-1', 'typescriptreact', root), join(root, 'Untitled-1.tsx'));
	assert.equal(fileNameOf('untitled:draft.js', 'javascript', root), join(root, 'draft.js'));
	assert.equal(fileNameOf('vscode-notebook-cell:/a/b%20c#x', 'javascript', root), join(root, 'b c#x.js'));
});

test('the workspace root is its first folder, else its root URI, when a file URI', () => {
	const folder = pathToFileURL(join('/work', 'one')).href;
	assert.equal(rootOf({ workspaceFolders: [{ uri: folder }], rootUri: 'file:///other' }), join('/work', 'one'));
	assert.equal(rootOf({ rootUri: folder }), join('/work', 'one'));
	assert.equal(rootOf({ rootUri: 'vsls:/remote' }), undefined);
	assert.equal(rootOf({}), undefined);
});

test('confirmation needs both document changes and change annotations', () => {
	const caps = (workspaceEdit) => ({ capabilities: { workspace: { workspaceEdit } } });
	assert.equal(annotationsOf(caps({ documentChanges: true, changeAnnotationSupport: {} })), true);
	assert.equal(annotationsOf(caps({ changeAnnotationSupport: {} })), false);
	assert.equal(annotationsOf(caps({ documentChanges: true })), false);
	assert.equal(annotationsOf({}), false);
});

test('framing: a message may arrive in pieces; a header without an end is refused', async () => {
	const client = connect();
	const bytes = frame({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { capabilities: {} } });
	// Id 7 is not one the client sent: its response is kept with the other messages.
	const reply = new Promise((resolve) => {
		const timer = setInterval(() => {
			const found = client.notifications.find((message) => message.id === 7);
			if (found !== undefined) {
				clearInterval(timer);
				resolve(found);
			}
		}, 5);
	});
	client.raw(bytes.subarray(0, 30));
	await new Promise((resolve) => setImmediate(resolve));
	client.raw(bytes.subarray(30));
	assert.equal((await reply).result.serverInfo.name, 'chartguard-language-server');
	const endless = connect();
	endless.raw(Buffer.from(`Content-Length: 5${' '.repeat(10_000)}`, 'ascii'));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(endless.exits, [1]);
});
