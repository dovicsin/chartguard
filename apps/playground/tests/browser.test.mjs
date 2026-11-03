import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';

import { browserSkipReason, dumpDom } from '../../../tools/shared/chrome.mjs';
import { skipOutsideCi } from '../../../tools/shared/ci.mjs';
import { OUT } from '../scripts/build.mjs';

const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.map': 'application/json'
};

/**
 * Serves the built playground from OUT on a free loopback port, with the header static hosts such as
 * GitHub Pages send: the drawing frame (an opaque origin) fetches its script with CORS.
 */
function serve() {
	const server = createServer((request, response) => {
		const path = normalize(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^(\.\.[/\\])+/, '');
		const file = join(OUT, path.endsWith('/') ? `${path}index.html` : path);
		if (!file.startsWith(OUT) || !existsSync(file)) {
			response.writeHead(404).end();
			return;
		}
		response
			.writeHead(200, {
				'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
				'access-control-allow-origin': '*'
			})
			.end(readFileSync(file));
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const unescape = (text) =>
	text.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

test(
	'in a real browser every example reproduces its pinned findings and runtime verdict, as JSON and as source, each draw in a sandboxed frame',
	{
		// On CI a missing browser or bundle fails the gate instead of skipping it (E22).
		skip: browserSkipReason() ?? (existsSync(join(OUT, 'main.js')) ? false : skipOutsideCi('needs a built playground')),
		timeout: 300_000
	},
	async (t) => {
		const server = await serve();
		t.after(() => server.close());
		const html = await dumpDom(`http://127.0.0.1:${String(server.address().port)}/?selftest`);
		const report = /<pre id="selftest">([\s\S]*?)<\/pre>/.exec(html);
		assert.ok(report !== null, 'the self-test report was not rendered');
		const entries = JSON.parse(unescape(report[1]));
		const examples = JSON.parse(readFileSync(join(OUT, 'examples.json'), 'utf8'));
		assert.deepEqual(
			entries.map(({ id }) => id),
			[...examples.map(({ id }) => id), ...examples.map(({ id }) => `javascript:${id}`), 'links', 'repeat', 'sandbox']
		);
		assert.deepEqual(
			entries.filter(({ problems }) => problems.length > 0),
			[]
		);
	}
);
