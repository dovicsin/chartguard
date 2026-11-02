import { readFileSync } from 'node:fs';

/** The CLI's own version, read when asked (nothing is read at import time). */
export function cliVersion(): string {
	const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const version: unknown =
		typeof manifest === 'object' && manifest !== null ? Reflect.get(manifest, 'version') : undefined;
	if (typeof version !== 'string') throw new Error('the CLI package.json has no version');
	return version;
}
