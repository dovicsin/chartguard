import { isContainer, keySegment, ownDataProperty } from '@chartguard/core';

import type { ValueAt, ValueSummary } from './chart.js';
import { type Default, defaulted, type Fact, known, type Listed, unknown, type UnknownFact } from './facts.js';

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

/**
 * An option the runtime resolves through scopes, most specific first (a series, then the options for
 * its type, then those for every series): the first scope that sets it. A scope that cannot be read
 * (a getter, a function) before it decides the fact; none set: the runtime default, at the most
 * specific path, or unset there.
 */
export function firstSet<T>(scopes: readonly Fact<T>[], fallback?: Default<T>): Fact<T> {
	const decided = scopes.find((fact) => fact.known || fact.reason !== 'unset');
	if (decided !== undefined) return decided;
	const at = scopes[0]?.path ?? '$';
	return fallback === undefined ? unknown(at, 'unset') : defaulted(fallback, at);
}

/**
 * Reads one element of a series' data: its value (with where it is), `null` for a gap the runtime
 * skips, or an unknown fact when the element's shape is not read.
 */
export type ElementReader = (element: unknown, path: readonly PathSegment[]) => ValueAt | null | UnknownFact;

/**
 * The values of the data array at `path`, read element by element through own data properties: a
 * missing array has none; an element behind a getter, or one `read` cannot read, leaves the summary
 * unknown (its smallest or largest value could be anywhere).
 */
export function valuesAt(root: unknown, path: readonly PathSegment[], read: ElementReader): Fact<ValueSummary> {
	const at = formatPath(path);
	const found = lookup(root, path);
	if (found.state === 'missing') return known({ count: 0, min: undefined, max: undefined }, at);
	if (found.state !== 'value') return unknown(at, found.state);
	if (!Array.isArray(found.value)) return unknown(at, typeof found.value === 'function' ? 'dynamic' : 'shape');
	const summary = summarize(found.value as unknown[], path, read);
	return 'known' in summary ? summary : known(summary, at);
}

/**
 * The values of `data`, or why they are not known: an element behind a getter hides the array's
 * contents (unknown at the array); an element `read` cannot read is unknown where `read` says.
 */
function summarize(
	data: readonly unknown[],
	path: readonly PathSegment[],
	read: ElementReader
): ValueSummary | UnknownFact {
	let summary: ValueSummary = { count: 0, min: undefined, max: undefined };
	for (let index = 0; index < data.length; index += 1) {
		const entry = ownDataProperty(data, String(index));
		if (!entry.found && entry.accessor) return unknown(formatPath(path), 'accessor');
		const value = entry.found ? read(entry.value, [...path, index]) : null;
		if (value !== null && 'known' in value) return value;
		if (value !== null) summary = including(summary, value);
	}
	return summary;
}

const including = ({ count, min, max }: ValueSummary, value: ValueAt): ValueSummary => ({
	count: count + 1,
	min: min === undefined || value.value < min.value ? value : min,
	max: max === undefined || value.value > max.value ? value : max
});

/** An element that is a finite number, a gap (`null`, `undefined`, `NaN`), or not one of these. */
export function numberElement(element: unknown, path: readonly PathSegment[]): ValueAt | null | undefined {
	if (element === null || element === undefined || (typeof element === 'number' && Number.isNaN(element))) return null;
	return isNumber(element) ? { value: element, path: formatPath(path) } : undefined;
}

/** `numberElement`, with anything that is neither a number nor a gap unknown for `reason` (a gap stays a gap). */
export function numberOr(
	element: unknown,
	path: readonly PathSegment[],
	reason: UnknownFact['reason']
): ValueAt | null | UnknownFact {
	const value = numberElement(element, path);
	return value === undefined ? unknown(formatPath(path), reason) : value;
}
