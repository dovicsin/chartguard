import { type Diagnostic, isContainer, ownDataProperty } from '@chartguard/core';

import { isListLike } from './kind.js';
import { isHandled, type Registries } from './registry.js';

/**
 * A rule over several options at once (CG-02-08): what one option requires of another, as the
 * library's runtime enforces it. Rules live with their adapter, cite the runtime code they mirror,
 * and make no claim when any value they need cannot be read without running code.
 */
export interface ConfigRule {
	/** Stable id, cited in docs and tests: `echarts/heatmap-visual-map`. */
	readonly id: string;
	check(input: unknown, context: RuleContext): readonly Diagnostic[];
}

export interface RuleContext {
	/** The runtime rejects the config: a confirmed error, or unresolved when the input is incomplete. */
	rejected(code: string, path: string, message: string, suggestion?: string): Diagnostic;
	/** The runtime warns and ignores something: a certain warning, or unresolved when the input is incomplete. */
	warned(code: string, path: string, message: string, suggestion?: string): Diagnostic;
	/** Whether `name` (or a subtype) is in registry `id`; undefined unless the caller gave a complete registry. */
	registered(id: string, name: string): boolean | undefined;
}

/** A value read without running code: `known: false` when a getter or a non-plain step is on the way. */
export type Read = { readonly known: true; readonly value: unknown } | { readonly known: false };

const UNKNOWN: Read = { known: false };

/**
 * Plain data: a list, or an object whose prototype is null or a root prototype with no enumerable
 * members of its own: `Object.prototype` of any realm (an iframe, a vm context), never an object
 * that inherits data (`Object.create({ a: 1 })`) or a class instance.
 */
function isPlain(value: object): boolean {
	if (isListLike(value)) return true;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === null) return true;
	return isContainer(prototype) && Object.getPrototypeOf(prototype) === null && Object.keys(prototype).length === 0;
}

/**
 * The own data value at `path` below `value`, as the runtime would read it: absent is a known
 * `undefined`; a getter, a primitive or an object with its own prototype on the way is unknown.
 */
export function readOwn(value: unknown, ...path: readonly (string | number)[]): Read {
	let current: unknown = value;
	for (const key of path) {
		if (current === undefined) return { known: true, value: undefined };
		if (!isContainer(current) || !isPlain(current)) return UNKNOWN;
		// A list is read by index only: `['pie'].type` is not data the runtime would find there.
		if (isListLike(current) && typeof key !== 'number') return UNKNOWN;
		const entry = ownDataProperty(current, String(key));
		if (!entry.found && entry.accessor) return UNKNOWN;
		current = entry.found ? entry.value : undefined;
	}
	return { known: true, value: current };
}

export interface Item {
	readonly path: string;
	readonly index: number;
	readonly value: unknown;
}

/**
 * The items of an option that takes one object or a list of them (`series`, `xAxis`), each with
 * its path; none when absent; undefined when it cannot be read exactly (a hole, a getter, a primitive).
 */
export function itemsOf(value: unknown, path: string): readonly Item[] | undefined {
	if (value === undefined) return [];
	if (!isContainer(value) || !isPlain(value)) return undefined;
	if (!isListLike(value)) return [{ path, index: 0, value }];
	const items: Item[] = [];
	for (let index = 0; index < value.length; index++) {
		const entry = ownDataProperty(value, String(index));
		if (!entry.found) return undefined;
		items.push({ path: `${path}[${String(index)}]`, index, value: entry.value });
	}
	return items;
}

/** The context rules run in: incomplete input turns their findings into unresolved ones. */
export function ruleContext(incomplete: boolean, registries: Registries): RuleContext {
	const finding =
		(severity: 'error' | 'warning') =>
		(code: string, path: string, message: string, suggestion?: string): Diagnostic => ({
			code,
			severity: incomplete ? 'warning' : severity,
			path,
			message,
			confidence: incomplete ? 'unknown' : 'certain',
			...(suggestion === undefined ? {} : { suggestion })
		});
	return {
		rejected: finding('error'),
		warned: finding('warning'),
		registered: (id, name) => isHandled(registries, { id, name, enforced: true })
	};
}
