import { isContainer, ownDataProperty } from '@chartguard/core';

/** Follows own data properties only; getters are never invoked. */
export function readPath(root: unknown, path: readonly (string | number)[]): unknown {
	let current = root;
	for (const segment of path) {
		if (!isContainer(current)) return undefined;
		const entry = ownDataProperty(current, String(segment));
		if (!entry.found) return undefined;
		current = entry.value;
	}
	return current;
}

export function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined;
}
