import { isContainer, ownDataProperty } from '@chartguard/core';

import type { Fact } from './chart.js';

export type PathSegment = string | number;

/** Follows own data properties only; getters are never invoked. */
export function readPath(root: unknown, path: readonly PathSegment[]): unknown {
	let current = root;
	for (const segment of path) {
		if (!isContainer(current)) return undefined;
		const entry = ownDataProperty(current, String(segment));
		if (!entry.found) return undefined;
		current = entry.value;
	}
	return current;
}

/** JSONPath-style rendering shared with the config engine, e.g. `$.series[0].type`. */
export function formatPath(path: readonly PathSegment[]): string {
	return path.reduce<string>(
		(text, segment) => (typeof segment === 'number' ? `${text}[${String(segment)}]` : `${text}.${segment}`),
		'$'
	);
}

function factAt<T>(
	root: unknown,
	path: readonly PathSegment[],
	is: (value: unknown) => value is T
): Fact<T> | undefined {
	const value = readPath(root, path);
	return is(value) ? { value, path: formatPath(path) } : undefined;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';

export function stringAt(root: unknown, path: readonly PathSegment[]): Fact<string> | undefined {
	return factAt(root, path, isString);
}

export function numberAt(root: unknown, path: readonly PathSegment[]): Fact<number> | undefined {
	return factAt(root, path, isNumber);
}
