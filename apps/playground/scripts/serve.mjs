import { context } from 'esbuild';

import { runAsEntryPoint } from '../../../tools/shared/entry.mjs';
import { bundleOptions, frameOptions, OUT, prepare } from './build.mjs';

/**
 * Where the dev server listens: this machine only, never every interface (esbuild's default). CORS
 * for the `null` origin only: the drawing frame (an opaque origin) fetches its script with CORS.
 */
export const serveOptions = (port) => ({ servedir: OUT, port, host: '127.0.0.1', cors: { origin: 'null' } });

/** Builds the playground, rebuilds on source changes and serves it: `npm run playground`. */
async function serve(port) {
	await prepare(OUT);
	const frame = await context(frameOptions(OUT));
	await frame.watch();
	const builder = await context(bundleOptions(OUT));
	await builder.watch();
	const { hosts, port: actual } = await builder.serve(serveOptions(port));
	process.stdout.write(`ChartGuard playground: http://${hosts[0] ?? '127.0.0.1'}:${String(actual)}/\n`);
}

await runAsEntryPoint(import.meta.url, async () => {
	await serve(Number(process.env['PORT'] ?? 8080));
});
