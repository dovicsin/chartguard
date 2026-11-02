import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { isRecord } from '@chartguard/core';

import { InputError } from './errors.js';

/**
 * The version of a package the project's lockfile pins (CG-06-02 part 4a): the nearest lockfile
 * upward from the file, for the project (workspace) the file is in. Read as data in the shapes npm,
 * pnpm and Yarn write; what it does not decide exactly is an input error, never a guess.
 */
export interface Locked {
	readonly version: string;
	readonly lockfile: string;
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;
type LockfileName = (typeof LOCKFILES)[number];
const EXACT = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u;
const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/** Where a lockfile and the file's project are. */
interface Place {
	readonly lockfile: string;
	readonly name: LockfileName;
	/** The project's directory relative to the lockfile's, `/`-separated; `''` for the root project. */
	readonly workspace: string;
	/** The project's `package.json`, when it has one. */
	readonly manifest: string | undefined;
}

/** The nearest lockfile upward from `file`, and the nearest project (a `package.json`) on the way. */
function placeOf(file: string): Place | undefined {
	let manifest: string | undefined;
	for (let directory = dirname(resolve(file)); ; directory = dirname(directory)) {
		if (manifest === undefined && existsSync(join(directory, 'package.json')))
			manifest = join(directory, 'package.json');
		const name = LOCKFILES.find((candidate) => existsSync(join(directory, candidate)));
		if (name !== undefined) {
			const project = manifest === undefined ? directory : dirname(manifest);
			const workspace = relative(directory, project).split(sep).join('/');
			return { lockfile: join(directory, name), name, workspace, manifest };
		}
		if (dirname(directory) === directory) return undefined;
	}
}

/** A version as a lockfile states it: exact, or the user's to name. */
function exact(version: string, place: Place): string {
	if (EXACT.test(version)) return version;
	throw new InputError(`${place.lockfile}: ${version} is not an exact version; pass --library-version <version>.`);
}

function npmVersion(lock: unknown, packageName: string, { workspace }: Place): string | undefined {
	if (!isRecord(lock)) return undefined;
	const { packages, dependencies } = lock;
	if (isRecord(packages)) {
		const keys = [
			...(workspace === '' ? [] : [`${workspace}/node_modules/${packageName}`]),
			`node_modules/${packageName}`
		];
		const entry = keys.map((key) => packages[key]).find(isRecord);
		return typeof entry?.['version'] === 'string' ? entry['version'] : undefined;
	}
	const entry = isRecord(dependencies) ? dependencies[packageName] : undefined;
	return isRecord(entry) && typeof entry['version'] === 'string' ? entry['version'] : undefined;
}

/** A YAML key or scalar as pnpm writes it: plain, or in single or double quotes. */
const unquoted = (text: string): string => text.trim().replace(/^(['"])(.*)\1$/u, '$2');

/** The indentation and the `key: value` of a YAML line (value `''` for a mapping that follows). */
function yamlLine(line: string): { readonly indent: number; readonly key: string; readonly value: string } | undefined {
	const match = /^( *)((?:'[^']*'|"[^"]*"|[^:'"]+)):(?: (.*))?$/u.exec(line);
	if (match === null) return undefined;
	return { indent: match[1]?.length ?? 0, key: unquoted(match[2] ?? ''), value: unquoted(match[3] ?? '') };
}

/** `importers.<workspace>.<kind>.<name>.version` of a pnpm lockfile (v6, v9), its peer suffix removed. */
function pnpmVersion(text: string, packageName: string, { workspace }: Place): string | undefined {
	const importer = workspace === '' ? '.' : workspace;
	const path: string[] = [];
	for (const line of text.split('\n')) {
		const parsed = yamlLine(line);
		if (parsed === undefined) continue;
		const depth = parsed.indent / 2;
		path.length = depth;
		path.push(parsed.key);
		const [top, owner, kind, name, field] = path;
		const ours = top === 'importers' && owner === importer && DEPENDENCY_KINDS.includes(kind ?? '');
		if (ours && name === packageName && field === 'version') return parsed.value.replace(/\(.*$/u, '');
	}
	return undefined;
}

/** The range the project's `package.json` declares for the package, in any dependency kind. */
async function declaredRange(manifest: string | undefined, packageName: string): Promise<string | undefined> {
	if (manifest === undefined) return undefined;
	const json: unknown = JSON.parse(await readFile(manifest, 'utf8'));
	if (!isRecord(json)) return undefined;
	for (const kind of DEPENDENCY_KINDS) {
		const declared = json[kind];
		const range = isRecord(declared) ? declared[packageName] : undefined;
		if (typeof range === 'string') return range;
	}
	return undefined;
}

/** Each Yarn entry for the package: its descriptors (`name@range`, Berry `name@npm:range`) and its version. */
function yarnEntries(
	text: string,
	packageName: string
): { readonly descriptors: string[]; readonly version: string }[] {
	const entries: { descriptors: string[]; version: string }[] = [];
	let current: string[] | undefined;
	for (const line of text.split('\n')) {
		if (/^\S.*:$/u.test(line)) {
			const descriptors = line.slice(0, -1).split(',').map(unquoted);
			current = descriptors.some((descriptor) => descriptor.startsWith(`${packageName}@`)) ? descriptors : undefined;
			continue;
		}
		const version = /^ {2}version:? "?([^"\s]+)"?$/u.exec(line)?.[1];
		if (current !== undefined && version !== undefined) entries.push({ descriptors: current, version });
	}
	return entries;
}

async function yarnVersion(text: string, packageName: string, place: Place): Promise<string | undefined> {
	const entries = yarnEntries(text, packageName);
	const range = await declaredRange(place.manifest, packageName);
	const wanted = range === undefined ? [] : [`${packageName}@${range}`, `${packageName}@npm:${range}`];
	const chosen =
		range === undefined
			? entries
			: entries.filter(({ descriptors }) => descriptors.some((descriptor) => wanted.includes(descriptor)));
	const versions = [...new Set(chosen.map(({ version }) => version))];
	if (versions.length > 1)
		throw new InputError(
			`${place.lockfile} holds ${String(versions.length)} versions of ${packageName} and the range the project declares does not pick one; pass --library-version <version>.`
		);
	return versions[0];
}

async function versionIn(place: Place, packageName: string): Promise<string | undefined> {
	const text = await readFile(place.lockfile, 'utf8');
	if (place.name === 'pnpm-lock.yaml') return pnpmVersion(text, packageName, place);
	if (place.name === 'yarn.lock') return yarnVersion(text, packageName, place);
	return npmVersion(JSON.parse(text) as unknown, packageName, place);
}

/** The version the nearest lockfile pins for `packageName` in the file's project; undefined when it has none. */
export async function lockedVersion(packageName: string, file: string): Promise<Locked | undefined> {
	const place = placeOf(file);
	if (place === undefined) return undefined;
	let version: string | undefined;
	try {
		version = await versionIn(place, packageName);
	} catch (error) {
		if (error instanceof InputError) throw error;
		throw new InputError(`${place.lockfile} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
	}
	return version === undefined ? undefined : { version: exact(version, place), lockfile: place.lockfile };
}
