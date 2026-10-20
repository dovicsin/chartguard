import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Directories never descended into: build output and installed dependencies (nothing is read from them). */
const SKIPPED = new Set(['dist', 'node_modules']);

/** Every package manifest below `directory` (build output and dependencies skipped), with its directory. */
export function manifestsUnder(directory) {
	const found = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (readdirSync(path).includes('package.json'))
			found.push({ path, manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) });
		found.push(...manifestsUnder(path));
	}
	return found;
}

/** The packages a release publishes: every package under `packages/` that is not private. */
export function publishedPackages(root) {
	return manifestsUnder(join(root, 'packages')).filter(({ manifest }) => manifest.private !== true);
}
