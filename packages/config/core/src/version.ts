/** `MAJOR.MINOR.PATCH[-prerelease]`; build metadata is not part of an installed package version. */
const EXACT = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
/** A schema version that only names its major (`13.x (starter subset)`). */
const MAJOR_ONLY = /^(\d+)\.x\b/;

/** An exact `MAJOR.MINOR.PATCH[-prerelease]` version. */
export interface Version {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly prerelease: string | undefined;
}

/** The exact version `text` names (surrounding whitespace ignored); undefined for a range or anything else. */
export function parseVersion(text: string): Version | undefined {
	const match = EXACT.exec(text.trim());
	if (match === null) return undefined;
	const [, major, minor, patch, prerelease] = match;
	return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease };
}

/**
 * How a requested (installed) version relates to the version a schema describes.
 * - `exact`: the schema is for this version.
 * - `same-major`: other minor, patch or prerelease; options and enum values may differ.
 * - `other-major`: the option model may be different altogether.
 * - `malformed`: the request is not an exact version.
 */
export type Compatibility = 'exact' | 'same-major' | 'other-major' | 'malformed';

/**
 * How the `requested` (installed) version relates to `schemaVersion`; a schema version that names only its
 * major (`13.x`) is never `exact`.
 */
export function compatibility(schemaVersion: string, requested: string): Compatibility {
	const wanted = parseVersion(requested);
	if (wanted === undefined) return 'malformed';
	const pinned = parseVersion(schemaVersion);
	if (pinned === undefined) {
		const major = MAJOR_ONLY.exec(schemaVersion)?.[1];
		return Number(major) === wanted.major ? 'same-major' : 'other-major';
	}
	if (pinned.major !== wanted.major) return 'other-major';
	const same =
		pinned.minor === wanted.minor && pinned.patch === wanted.patch && pinned.prerelease === wanted.prerelease;
	return same ? 'exact' : 'same-major';
}
