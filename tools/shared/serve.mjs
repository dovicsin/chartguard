import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.map': 'application/json',
	'.txt': 'text/plain'
};

/**
 * Serves the files below `root` on a free port of the loopback interface only (E-rows: a local
 * server listens on loopback), for a browser test. `headers` are sent with every file (static hosts
 * such as GitHub Pages send CORS headers); `extra` maps a path to a body served instead of a file;
 * `transform(path, body)` may change a file as it is served. Resolves with the server once it listens.
 */
export function serveDirectory(root, { headers = {}, extra = {}, transform = (_path, body) => body } = {}) {
	const server = createServer((request, response) => {
		const path = normalize(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^(\.\.[/\\])+/u, '');
		const served = path.endsWith('/') ? `${path}index.html` : path;
		const file = join(root, served);
		const found = file.startsWith(root) && existsSync(file) ? transform(served, readFileSync(file)) : undefined;
		const body = Object.hasOwn(extra, served) ? extra[served] : found;
		if (body === undefined) {
			response.writeHead(404).end();
			return;
		}
		response
			.writeHead(200, { 'content-type': TYPES[extname(served)] ?? 'application/octet-stream', ...headers })
			.end(body);
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}
