import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The upstream pins this generator was written and verified against (one exact version per library). */
const PINS = JSON.parse(readFileSync(new URL('../upstream-sources.json', import.meta.url), 'utf8'));

/**
 * The project's install cannot be used: not installed, another major than the generator supports,
 * a library whose schema ships with its adapter, or declarations and runtime the generator cannot
 * read. A situation for the user to resolve, not a defect of the generator.
 */
export class UpstreamError extends Error {
	name = 'UpstreamError';
}

export function pinOf(library) {
	const pin = PINS.libraries.find((entry) => entry.library === library);
	if (pin === undefined) throw new UpstreamError(`No upstream pin for ${library}`);
	return pin;
}

function installedVersion(root, packageName) {
	try {
		return JSON.parse(readFileSync(join(root, 'node_modules', packageName, 'package.json'), 'utf8')).version;
	} catch {
		throw new UpstreamError(`${packageName} is not installed in ${root}`);
	}
}

function lockfileEntry(root, packageName) {
	try {
		return JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages?.[`node_modules/${packageName}`];
	} catch {
		return undefined;
	}
}

/** Upstream pin from upstream-sources.json, verified against what npm installed in this repository. */
export function verifiedUpstream(root, library) {
	const pin = pinOf(library);
	const installed = installedVersion(root, pin.package);
	const locked = lockfileEntry(root, pin.package);
	if (installed !== pin.version || locked?.version !== pin.version)
		throw new UpstreamError(`${pin.package}: installed ${installed}, pinned ${pin.version}`);
	if (locked.integrity !== pin.integrity)
		throw new UpstreamError(`${pin.package}: lockfile integrity differs from the pin`);
	return pin;
}

function packageFiles(directory, root = directory) {
	return readdirSync(directory, { withFileTypes: true })
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : packageFiles(path, root);
			return entry.isFile() ? [relative(root, path).split(sep).join('/')] : [];
		})
		.sort();
}

/** `sha256-<base64>` over every file of an installed package, path and content: what the schema was derived from. */
export function contentIntegrity(directory) {
	const hash = createHash('sha256');
	for (const file of packageFiles(directory))
		hash
			.update(file)
			.update('\0')
			.update(readFileSync(join(directory, file)))
			.update('\0');
	return `sha256-${hash.digest('base64')}`;
}

const major = (version) => version.split('.')[0];

/**
 * The pin for the version a project actually installed: the same major as this generator's pin,
 * with the integrity of that install (its npm lockfile entry, or a hash of its files), so the
 * facts derived from it stay traceable to exactly what was read.
 */
export function installedUpstream(root, library) {
	const pin = pinOf(library);
	const version = installedVersion(root, pin.package);
	if (major(version) !== major(pin.version))
		throw new UpstreamError(
			`${pin.package} ${version} is not supported: this generator reads ${major(pin.version)}.x (pinned ${pin.version}).`
		);
	const locked = lockfileEntry(root, pin.package);
	const integrity =
		locked?.version === version && typeof locked.integrity === 'string'
			? locked.integrity
			: contentIntegrity(join(root, 'node_modules', pin.package));
	return { ...pin, version, integrity };
}
