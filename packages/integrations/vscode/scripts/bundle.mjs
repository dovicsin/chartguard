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

/** What a VSIX holds of code (warnings are thrown by `built`, never only printed): two CommonJS bundles, the extension (VS Code provides `vscode`) and the server. */
const COMMON = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', metafile: true, logLevel: 'silent' };

/**
 * A build that warned is no bundle: esbuild warns where the bundle differs from the sources it holds
 * (`import.meta` is empty in CommonJS, so a module reading a file beside itself fails when loaded).
 */
export async function built(options) {
	const result = await build(options);
	if (result.warnings.length > 0)
		throw new Error(
			`${options.outfile}: esbuild warned:\n${result.warnings.map(({ text, location }) => `${location?.file ?? ''}:${String(location?.line ?? '')} ${text}`).join('\n')}`
		);
	return result;
}

/** Bundles the extension and the server from the compiled sources, and writes the notices of what they hold. */
export async function bundle() {
	const extension = await built({
		...COMMON,
		entryPoints: [join(DIST, 'extension.js')],
		outfile: join(DIST, 'extension.cjs'),
		external: ['vscode']
	});
	const server = await built({ ...COMMON, entryPoints: [join(DIST, 'server.js')], outfile: join(DIST, 'server.cjs') });
	const inputs = [...Object.keys(extension.metafile.inputs), ...Object.keys(server.metafile.inputs)];
	const entries = noticesOf(inputs, PACKAGE);
	writeFileSync(NOTICES, noticesText(entries));
	return { inputs, packages: entries.map(({ name }) => name) };
}

await runAsEntryPoint(import.meta.url, async () => {
	await bundle();
});
