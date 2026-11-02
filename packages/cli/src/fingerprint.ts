import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isRecord } from '@chartguard/core';

/**
 * The ChartGuard code a result is computed by (CG-06-02 part 4d): the content of every `.js` and
 * `.json` file in the `dist` of the CLI and of each `@chartguard` package it depends on,
 * transitively. By content, never by version: a build from source keeps its version.
 */
const SCOPE = '@chartguard/';
const CODE = /\.(?:js|json)$/u;
/** A bound on the entries one fingerprint walks, over all packages (they hold some hundreds). */
const MAX_FILES = 20_000;

async function manifestOf(directory: string): Promise<Record<string, unknown>> {
	const manifest: unknown = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
	return isRecord(manifest) ? manifest : {};
}

/** The `@chartguard` packages a package depends on. */
async function dependenciesOf(directory: string): Promise<string[]> {
	const { dependencies } = await manifestOf(directory);
	return isRecord(dependencies) ? Object.keys(dependencies).filter((name) => name.startsWith(SCOPE)) : [];
}

/** Where Node finds `name` from `directory`: `node_modules/<name>` there or upward, as its real directory. */
function packageDir(name: string, directory: string): string {
	for (let at = directory; ; at = dirname(at)) {
		const candidate = join(at, 'node_modules', ...name.split('/'));
		if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
		if (dirname(at) === at) throw new Error(`${name} is not installed for ${directory}`);
	}
}

/**
 * Every code file under `dist`, in code-unit order (never by locale), and how many entries the walk
 * met; no directory link is followed, and more than `limit` entries is an error.
 */
async function codeFiles(dist: string, limit: number): Promise<{ files: string[]; seen: number }> {
	const files: string[] = [];
	const pending = [dist];
	let seen = 0;
	for (let directory = pending.pop(); directory !== undefined; directory = pending.pop()) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) pending.push(path);
			else if (entry.isFile() && CODE.test(entry.name)) files.push(path);
			if (++seen > limit) throw new Error('more files under the ChartGuard packages than a fingerprint reads');
		}
	}
	return { files: files.sort(), seen };
}

/** The package at `cli` and every `@chartguard` package it depends on, transitively: name → real directory. */
async function packagesFrom(cli: string): Promise<Map<string, string>> {
	const seen = new Map<string, string>([['@chartguard/cli', realpathSync(cli)]]);
	const pending = ['@chartguard/cli'];
	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const directory = seen.get(name) ?? '';
		for (const dependency of await dependenciesOf(directory))
			if (!seen.has(dependency)) {
				seen.set(dependency, packageDir(dependency, directory));
				pending.push(dependency);
			}
	}
	return seen;
}

/** The fingerprint of the package at `cli` (by default this CLI) and its `@chartguard` dependencies. */
export async function codeFingerprint(
	cli: string = fileURLToPath(new URL('..', import.meta.url)),
	limit = MAX_FILES
): Promise<string> {
	const hash = createHash('sha256');
	const seen = await packagesFrom(cli);
	let left = limit;
	for (const name of [...seen.keys()].sort()) {
		const dist = join(seen.get(name) ?? '', 'dist');
		hash.update(`${name}\0`);
		const { files, seen: met } = await codeFiles(dist, left);
		left -= met;
		for (const file of files)
			hash
				.update(`${relative(dist, file).split(sep).join('/')}\0`)
				.update(await readFile(file))
				.update('\0');
	}
	return hash.digest('hex');
}
