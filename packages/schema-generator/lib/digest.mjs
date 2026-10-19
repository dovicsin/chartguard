import { createHash } from 'node:crypto';

/** The committed artifact text: tab-indented JSON with a final newline. */
export function serialize(artifact) {
	return `${JSON.stringify(artifact, null, '\t')}\n`;
}

/** The object without the named keys, key order kept. */
export function omit(object, keys) {
	return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
}

/** `sha256-<hex>` of the canonical text with the `digest` field left out. */
export function digestOf(artifact) {
	return `sha256-${createHash('sha256')
		.update(serialize(omit(artifact, ['digest'])))
		.digest('hex')}`;
}

/** The artifact with its digest placed in the header, right after `generator`. */
export function withDigest(artifact) {
	const digest = digestOf(artifact);
	return Object.fromEntries(
		Object.entries(artifact).flatMap(([key, value]) =>
			key === 'generator'
				? [
						[key, value],
						['digest', digest]
					]
				: [[key, value]]
		)
	);
}
