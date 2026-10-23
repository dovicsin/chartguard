import { context } from 'esbuild';

import { runAsEntryPoint } from '../../../tools/shared/entry.mjs';
import { bundleOptions, OUT, prepare } from './build.mjs';

/** Where the dev server listens: this machine only, never every interface (esbuild's default). */
export const serveOptions = (port) => ({ servedir: OUT, port, host: '127.0.0.1' });

/** Builds the playground, rebuilds on source changes and serves it: `npm run playground`. */
async function serve(port) {
	await prepare(OUT);
	const builder = await context(bundleOptions(OUT));
	await builder.watch();
	const { hosts, port: actual } = await builder.serve(serveOptions(port));
	process.stdout.write(`ChartGuard playground: http://${hosts[0] ?? '127.0.0.1'}:${String(actual)}/\n`);
}

await runAsEntryPoint(import.meta.url, async () => {
	await serve(Number(process.env['PORT'] ?? 8080));
});
