import { isContainer, keySegment, ownDataProperty } from '@chartguard/core';

import { type Default, defaulted, type Fact, known, type Listed, unknown } from './facts.js';

export type PathSegment = string | number;

/** The engine path syntax (`keySegment`): `$.series[0].type`, `$.options.scales["y-left"].min` (E29). */
export function formatPath(path: readonly PathSegment[]): string {
	return path.reduce<string>(
		(text, segment) => (typeof segment === 'number' ? `${text}[${String(segment)}]` : `${text}${keySegment(segment)}`),
		'$'
	);
}

type Lookup =
	{ readonly state: 'value'; readonly value: unknown } | { readonly state: 'missing' | 'accessor' | 'shape' };

/** Follows own data properties only; getters are never run. A missing step is `missing`, a primitive on the way `shape`. */
function lookup(root: unknown, path: readonly PathSegment[]): Lookup {
	let current = root;
	for (const segment of path) {
		if (current === undefined) return { state: 'missing' };
		if (!isContainer(current)) return { state: 'shape' };
		const entry = ownDataProperty(current, String(segment));
		if (!entry.found) return { state: entry.accessor ? 'accessor' : 'missing' };
		current = entry.value;
	}
	return current === undefined ? { state: 'missing' } : { state: 'value', value: current };
}

/** The value at `path` through own data properties only, or undefined. */
export function readPath(root: unknown, path: readonly PathSegment[]): unknown {
	const found = lookup(root, path);
	return found.state === 'value' ? found.value : undefined;
}

/**
 * The fact at `path`: known when the config holds a value `is` accepts; the runtime default when it
 * holds none and one is given; otherwise unknown, with why.
 */
export function readFact<T>(
	root: unknown,
	path: readonly PathSegment[],
	is: (value: unknown) => value is T,
	fallback?: Default<T>
): Fact<T> {
	const at = formatPath(path);
	const found = lookup(root, path);
	if (found.state === 'missing') return fallback === undefined ? unknown(at, 'unset') : defaulted(fallback, at);
	if (found.state !== 'value') return unknown(at, found.state);
	if (is(found.value)) return known(found.value, at);
	return unknown(at, typeof found.value === 'function' ? 'dynamic' : 'shape');
}

/** An item of a list in the config: its value and where it is. */
export interface Item {
	readonly value: unknown;
	readonly segments: readonly PathSegment[];
	readonly path: string;
}

/**
 * The items of the list at `path`. A missing list is empty (every library treats it so); `single`
 * reads an object there as a list of that one item, at the object's own path (ECharts and
 * Highcharts accept `series: {…}` and `yAxis: {…}`).
 */
export function itemsAt(root: unknown, path: readonly PathSegment[], { single = false } = {}): Listed<Item> {
	const at = formatPath(path);
	const found = lookup(root, path);
	if (found.state === 'missing') return { known: true, path: at, items: [] };
	if (found.state !== 'value') return unknown(at, found.state);
	if (Array.isArray(found.value)) {
		const items = (found.value as unknown[]).map((_, index) => {
			const segments = [...path, index];
			return { value: readPath(root, segments), segments, path: formatPath(segments) };
		});
		return { known: true, path: at, items };
	}
	if (single && isContainer(found.value))
		return { known: true, path: at, items: [{ value: found.value, segments: path, path: at }] };
	return unknown(at, typeof found.value === 'function' ? 'dynamic' : 'shape');
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
