import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';

import { browserSkipReason, dumpDom } from '../../../tools/shared/chrome.mjs';
import { OUT } from '../scripts/build.mjs';

const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.map': 'application/json'
};

/** Serves the built playground from OUT on a free loopback port. */
function serve() {
	const server = createServer((request, response) => {
		const path = normalize(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^(\.\.[/\\])+/, '');
		const file = join(OUT, path.endsWith('/') ? `${path}index.html` : path);
		if (!file.startsWith(OUT) || !existsSync(file)) {
			response.writeHead(404).end();
			return;
		}
		response
			.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
			.end(readFileSync(file));
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const unescape = (text) =>
	text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

test(
	'in a real browser every example reproduces its pinned validator findings and runtime verdict',
	{
		skip: browserSkipReason() ?? (existsSync(join(OUT, 'main.js')) ? false : 'needs a built playground'),
		timeout: 180_000
	},
	async (t) => {
		const server = await serve();
		t.after(() => server.close());
		const html = await dumpDom(`http://127.0.0.1:${String(server.address().port)}/?selftest`);
		const report = /<pre id="selftest">([\s\S]*?)<\/pre>/.exec(html);
		assert.ok(report !== null, 'the self-test report was not rendered');
		const entries = JSON.parse(unescape(report[1]));
		const examples = JSON.parse(readFileSync(join(OUT, 'examples.json'), 'utf8'));
		assert.equal(entries.length, examples.length);
		assert.deepEqual(
			entries.filter(({ problems }) => problems.length > 0),
			[]
		);
	}
);
