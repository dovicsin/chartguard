import { readOwn } from './rules.js';
import type { DefaultFrom } from './schema.js';

/**
 * The value a `defaultFrom` names, read from the root of the config the way the runtime reads it
 * after merging its defaults: a missing or `undefined` value is the fallback. `undefined` when the
 * runtime may read something this cannot know (`readOwn`: a getter, a non-plain step).
 */
export function inheritedValue(from: DefaultFrom, root: unknown): { readonly value: unknown } | undefined {
	const read = readOwn(root, ...from.path);
	if (!read.known) return undefined;
	return { value: read.value === undefined ? from.fallback : read.value };
}
