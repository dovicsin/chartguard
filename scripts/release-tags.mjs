import { fileURLToPath } from 'node:url';

import { runAsEntryPoint } from '../tools/shared/entry.mjs';
import { publishedPackages } from '../tools/shared/workspace.mjs';

/**
 * The tags a release writes on its commit (E92): each published package at its version, as
 * Changesets names them (`@chartguard/core@0.1.1`), and the action at the version of the CLI it
 * runs (`v0.1.1`), which users pin `dovicsin/chartguard@v0.1.1` to. In code-unit order.
 */
export function releaseTags(manifests) {
	const tags = manifests.map(({ name, version }) => `${name}@${version}`);
	const cli = manifests.find(({ name }) => name === '@chartguard/cli');
	if (cli === undefined) throw new Error('the release publishes no @chartguard/cli, which the action runs');
	// The default sort compares UTF-16 code units, never by locale.
	return [...tags, `v${cli.version}`].sort();
}

await runAsEntryPoint(import.meta.url, () => {
	const root = fileURLToPath(new URL('..', import.meta.url));
	process.stdout.write(`${releaseTags(publishedPackages(root).map(({ manifest }) => manifest)).join('\n')}\n`);
});
