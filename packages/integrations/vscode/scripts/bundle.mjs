import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import { runAsEntryPoint } from '../../../../tools/shared/entry.mjs';
import { noticesOf, noticesText } from '../../../../tools/shared/notices.mjs';

export { byCodeUnit } from '../../../../tools/shared/notices.mjs';

/** The extension package, wherever this script is run from (E7). */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(PACKAGE, 'dist');
export const NOTICES = join(DIST, 'THIRD-PARTY-NOTICES.txt');

/** What a VSIX holds of code: two CommonJS bundles, the extension (VS Code provides `vscode`) and the server. */
const COMMON = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', metafile: true, logLevel: 'warning' };

/** Bundles the extension and the server from the compiled sources, and writes the notices of what they hold. */
export async function bundle() {
	const extension = await build({
		...COMMON,
		entryPoints: [join(DIST, 'extension.js')],
		outfile: join(DIST, 'extension.cjs'),
		external: ['vscode']
	});
	const server = await build({ ...COMMON, entryPoints: [join(DIST, 'server.js')], outfile: join(DIST, 'server.cjs') });
	const inputs = [...Object.keys(extension.metafile.inputs), ...Object.keys(server.metafile.inputs)];
	const entries = noticesOf(inputs, PACKAGE);
	writeFileSync(NOTICES, noticesText(entries));
	return { inputs, packages: entries.map(({ name }) => name) };
}

await runAsEntryPoint(import.meta.url, async () => {
	await bundle();
});
