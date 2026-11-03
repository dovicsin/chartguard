import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import test from 'node:test';

import { browserSkipReason, dumpDom } from '../../../tools/shared/chrome.mjs';
import { skipOutsideCi } from '../../../tools/shared/ci.mjs';
import { OUT } from '../scripts/build.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

/** Serves the built reference from OUT on a free loopback port. */
function serve() {
	const server = createServer((request, response) => {
		const path = normalize(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^(\.\.[/\\])+/u, '');
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

/** The result links the search page lists for `query`. */
async function found(port, query) {
	const html = await dumpDom(`http://127.0.0.1:${String(port)}/search.html?q=${encodeURIComponent(query)}`);
	assert.match(html, /data-ready="true"/u, 'the search script did not run');
	const list = /<ol id="results"[^>]*>([\s\S]*?)<\/ol>/u.exec(html)?.[1] ?? '';
	return [...list.matchAll(/<a href="([^"]*)">/gu)].map(([, href]) => href);
}

test(
	'in a real browser the search page finds a code, a rule and an export by name',
	{
		// On CI a missing browser or site fails the gate instead of skipping it (E22).
		skip:
			browserSkipReason() ?? (existsSync(join(OUT, 'search.html')) ? false : skipOutsideCi('needs a built reference')),
		timeout: 120_000
	},
	async (t) => {
		const server = await serve();
		t.after(() => server.close());
		const { port } = server.address();
		assert.equal((await found(port, 'CFG_TYPE'))[0], 'codes.html#CFG_TYPE');
		assert.equal((await found(port, 'bar baseline'))[0], 'rules.html#VIS_BAR_BASELINE');
		assert.ok((await found(port, 'applyFix')).includes('api/core.html#applyFix'));
		assert.deepEqual(await found(port, 'no-such-thing-anywhere'), []);
	}
);
