import type { Deprecation } from '@chartguard/config-core';
import { isContainer, ownDataProperty, pathSegments } from '@chartguard/core';

import docs from './generated/echarts-docs.json' with { type: 'json' };

/** The documented anchors a deprecation may link to, pinned from the documentation's option outline (CG-02-06). */
const ANCHORS: ReadonlySet<string> = new Set(docs.anchors);

/** An own data property's value; undefined for an accessor (never run) or a value that is not an object. */
function own(value: unknown, key: string): unknown {
	if (!isContainer(value)) return undefined;
	const entry = ownDataProperty(value, key);
	return entry.found ? entry.value : undefined;
}

/** The documentation's names for the place at `segments`: `series-pie.label` (the list item's type after `-`), and without the type. */
function placeNames(segments: readonly (string | number)[], config: unknown): string[] {
	const [top, ...rest] = segments;
	if (typeof top !== 'string') return [];
	let item: unknown = own(config, top);
	const keys: string[] = [];
	for (const segment of rest) {
		if (typeof segment === 'number' && keys.length === 0) item = own(item, String(segment));
		else if (typeof segment === 'string') keys.push(segment);
	}
	// Read without getters: a type behind an accessor is not known, and names nothing.
	const type = own(item, 'type');
	const typed = typeof type === 'string' ? [`${top}-${type}`] : [];
	return [...typed, top].map((head) => [head, ...keys].join('.'));
}

/** What replaces the option: a path from the option root as it is, a sibling's name at each place. */
function replacementAnchors(replacement: string | undefined, places: readonly string[]): string[] {
	if (replacement === undefined) return [];
	return replacement.includes('.') ? [replacement] : places.map((place) => `${place}.${replacement}`);
}

/**
 * Where the migration of a deprecated option is documented: what replaces it at the same place
 * (or at a path from the option root, such as `grid.outerBounds`), else the option itself; only
 * an anchor the pinned outline has.
 */
export function documentationOf(path: string, config: unknown, { replacement }: Deprecation): string | undefined {
	const segments = pathSegments(path);
	const name = segments?.at(-1);
	if (segments === undefined || typeof name !== 'string') return undefined;
	const places = placeNames(segments.slice(0, -1), config);
	const replaced = replacementAnchors(replacement, places);
	const anchor = [...replaced, ...places.map((place) => `${place}.${name}`)].find((candidate) =>
		ANCHORS.has(candidate)
	);
	return anchor === undefined ? undefined : `${docs.page}#${anchor}`;
}
