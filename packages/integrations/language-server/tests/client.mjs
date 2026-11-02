import { PassThrough } from 'node:stream';

import { serve } from '../dist/index.js';

/** One LSP message as the protocol frames it: a `Content-Length` header (in bytes) and the JSON body. */
export const frame = (message) => {
	const body = Buffer.from(JSON.stringify(message), 'utf8');
	return Buffer.concat([Buffer.from(`Content-Length: ${String(body.length)}\r\n\r\n`, 'ascii'), body]);
};

/** Splits the server's output into messages. */
function parser(onMessage) {
	let buffered = Buffer.alloc(0);
	return (chunk) => {
		buffered = Buffer.concat([buffered, chunk]);
		for (;;) {
			const end = buffered.indexOf('\r\n\r\n');
			if (end === -1) return;
			const length = Number(/Content-Length: (\d+)/u.exec(buffered.subarray(0, end).toString('ascii'))?.[1]);
			if (buffered.length < end + 4 + length) return;
			onMessage(JSON.parse(buffered.subarray(end + 4, end + 4 + length).toString('utf8')));
			buffered = buffered.subarray(end + 4 + length);
		}
	};
}

/**
 * A client talking to a server in this process over streams: requests resolve with their response,
 * `next(method)` waits for the next notification of that method.
 */
/** Routes the server's messages: responses to their requests, notifications to whoever waits for them. */
function router() {
	const pending = new Map();
	const notifications = [];
	const waiting = [];
	const deliver = (message) => {
		if (message.id !== undefined && message.method === undefined && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
			return;
		}
		const waiter = waiting.findIndex((w) => w.method === message.method);
		if (waiter === -1) notifications.push(message);
		else waiting.splice(waiter, 1)[0].resolve(message);
	};
	const next = (method) => {
		const queued = notifications.findIndex((message) => message.method === method);
		if (queued !== -1) return Promise.resolve(notifications.splice(queued, 1)[0]);
		return new Promise((resolve) => waiting.push({ method, resolve }));
	};
	return { pending, notifications, deliver, next };
}

/**
 * A client talking to a server in this process over streams: requests resolve with their response,
 * `next(method)` waits for the next notification of that method.
 */
export function connect({ delay = 0 } = {}) {
	const input = new PassThrough();
	const output = new PassThrough();
	const exits = [];
	serve({ input, output, delay, onExit: (code) => exits.push(code) });
	const { pending, notifications, deliver, next } = router();
	output.on('data', parser(deliver));
	let id = 0;
	const request = (method, params) =>
		new Promise((resolve) => {
			id += 1;
			pending.set(id, resolve);
			input.write(frame({ jsonrpc: '2.0', id, method, params }));
		});
	const notify = (method, params) => input.write(frame({ jsonrpc: '2.0', method, params }));
	return {
		exits,
		notifications,
		raw: (bytes) => input.write(bytes),
		request,
		notify,
		next,
		async initialize(params = {}) {
			const response = await request('initialize', { processId: null, rootUri: null, capabilities: {}, ...params });
			notify('initialized', {});
			return response;
		},
		open(uri, text, languageId = 'javascript') {
			notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
			return next('textDocument/publishDiagnostics');
		}
	};
}
