import { isContainer, ownDataProperty } from '@chartguard/core';

import { isListLike } from './kind.js';
import type { DefaultFrom } from './schema.js';

/**
 * The value a `defaultFrom` names, read from the root of the config the way the runtime reads it
 * after merging its defaults: a missing or `undefined` value is the fallback. `undefined` when the
 * runtime may read something this cannot know: a getter on the way (never run) or a step that is
 * not a plain object.
 */
export function inheritedValue(from: DefaultFrom, root: unknown): { readonly value: unknown } | undefined {
	let current: unknown = root;
	for (const key of from.path) {
		if (current === undefined) break;
		if (!isContainer(current) || isListLike(current)) return undefined;
		const entry = ownDataProperty(current, key);
		if (!entry.found && entry.accessor) return undefined;
		current = entry.found ? entry.value : undefined;
	}
	return { value: current === undefined ? from.fallback : current };
}
