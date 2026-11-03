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

/** The self-test report of one page load (`?selftest=<mode>`). */
async function selfTest(port, mode) {
	const html = await dumpDom(`http://127.0.0.1:${String(port)}/?selftest=${mode}`);
	const report = /<pre id="selftest">([\s\S]*?)<\/pre>/.exec(html);
	assert.ok(report !== null, `the ${mode} self-test report was not rendered`);
	return JSON.parse(unescape(report[1]));
}

test(
	'in a real browser every example reproduces its pinned validator findings and runtime verdict, as JSON and as source',
	{
		// On CI a missing browser or bundle fails the gate instead of skipping it (E22).
		skip: browserSkipReason() ?? (existsSync(join(OUT, 'main.js')) ? false : skipOutsideCi('needs a built playground')),
		timeout: 300_000
	},
	async (t) => {
		const server = await serve();
		t.after(() => server.close());
		const { port } = server.address();
		const examples = JSON.parse(readFileSync(join(OUT, 'examples.json'), 'utf8'));
		const json = await selfTest(port, 'json');
		assert.deepEqual(
			json.map(({ id }) => id),
			[...examples.map(({ id }) => id), 'links', 'repeat']
		);
		const source = await selfTest(port, 'javascript');
		assert.deepEqual(
			source.map(({ id }) => id),
			examples.map(({ id }) => `javascript:${id}`)
		);
		assert.deepEqual(
			[...json, ...source].filter(({ problems }) => problems.length > 0),
			[]
		);
	}
);
