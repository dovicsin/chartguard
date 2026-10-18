import { context } from 'esbuild';

import { isEntryPoint } from '../../../tools/shared/entry.mjs';
import { bundleOptions, OUT, prepare } from './build.mjs';

/** Builds the playground, rebuilds on source changes and serves it: `npm run playground`. */
async function serve(port) {
	await prepare(OUT);
	const builder = await context(bundleOptions(OUT));
	await builder.watch();
	const { hosts, port: actual } = await builder.serve({ servedir: OUT, port });
	process.stdout.write(`ChartGuard playground: http://${hosts[0] ?? 'localhost'}:${String(actual)}/\n`);
}

if (isEntryPoint(import.meta.url)) await serve(Number(process.env['PORT'] ?? 8080));
