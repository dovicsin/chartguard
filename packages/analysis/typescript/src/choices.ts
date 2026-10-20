import { isContainer, isRecord, ownDataProperty } from '@chartguard/core';
import type ts from 'typescript';

import { type Decoded, known, UNRESOLVED } from './decoded.js';
import type { Trace } from './trace.js';

/** Whether a decoded value is truthy, when that is known: an object is truthy even if incomplete. */
export function truthiness({ value, complete }: Decoded): boolean | undefined {
	if (isContainer(value)) return true;
	return complete ? Boolean(value) : undefined;
}

/** `a === b` (or `!==`) between complete primitives; anything else is unknown. */
export function strictEquality(left: Decoded, right: Decoded, negated: boolean): Decoded {
	if (!left.complete || !right.complete || isContainer(left.value) || isContainer(right.value)) return UNRESOLVED;
	return known(negated !== (left.value === right.value));
}

/** The value of `a ?? b`, `a || b` or `a && b` once the left side decides it, else undefined. */
export function logical(operator: '??' | '||' | '&&', left: Decoded, right: () => Decoded): Decoded | undefined {
	if (operator === '??') {
		if (isContainer(left.value)) return left;
		if (!left.complete) return undefined;
		return left.value === null || left.value === undefined ? right() : left;
	}
	const truthy = truthiness(left);
	if (truthy === undefined) return undefined;
	return truthy === (operator === '||') ? left : right();
}

const ABSENT = Symbol('absent');

function commonEntries(
	a: object,
	b: object,
	keys: readonly string[],
	target: Record<string, unknown> | unknown[]
): boolean {
	let same = true;
	for (const key of keys) {
		const left = ownDataProperty(a, key);
		const right = ownDataProperty(b, key);
		const part = left.found && right.found ? common(left.value, right.value) : { value: ABSENT, same: false };
		same &&= part.same;
		if (part.value !== ABSENT) Reflect.set(target, key, part.value);
	}
	return same;
}

/** What two values agree on: equal primitives, the shared keys of objects, equal-length arrays element by element. */
function common(a: unknown, b: unknown): { value: unknown; same: boolean } {
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return { value: ABSENT, same: false };
		const merged: unknown[] = new Array<unknown>(a.length);
		const same = commonEntries(
			a,
			b,
			a.map((_, index) => String(index)),
			merged
		);
		return { value: merged, same };
	}
	if (isRecord(a) && isRecord(b)) {
		const merged = Object.create(null) as Record<string, unknown>;
		const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
		return { value: merged, same: commonEntries(a, b, keys, merged) };
	}
	return Object.is(a, b) ? { value: a, same: true } : { value: ABSENT, same: false };
}

const CHOICE = 'choice' as const;

const keysOf = (trace: Trace | undefined): Iterable<string> => trace?.entries?.keys() ?? [];
const childOf = (trace: Trace | undefined, key: string): Trace | undefined => trace?.entries?.get(key);

/** Keys may vary when either side's keys may. */
function openOf(left: Trace | undefined, right: Trace | undefined, node: ts.Node): Pick<Trace, 'open'> {
	return left?.open === undefined && right?.open === undefined ? {} : { open: { node, reason: CHOICE } };
}

/** The trace of what two sides agree on: a kept part keeps the first side's origin; the rest is unknown, a `choice`. */
function agreedTrace(merged: unknown, left: Trace | undefined, right: Trace | undefined, node: ts.Node): Trace {
	if (merged === ABSENT) return { node, unknown: CHOICE };
	if (!isContainer(merged)) return left ?? { node };
	const entries = new Map<string, Trace>();
	for (const key of new Set([...keysOf(left), ...keysOf(right)])) {
		const entry = ownDataProperty(merged, key);
		const child = entry.found ? agreedTrace(entry.value, childOf(left, key), childOf(right, key), node) : undefined;
		entries.set(key, child ?? { node, unknown: CHOICE });
	}
	return { node: left?.node ?? node, entries, ...openOf(left, right, node) };
}

/**
 * Either of two values, when which one is not known: only what both agree on is kept (A3 gaps for
 * the rest), and the result is complete only when both are complete and equal (CG-03-05).
 */
export function agreement(a: Decoded, b: Decoded, node: ts.Node): Decoded {
	const { value, same } = common(a.value, b.value);
	const trace = agreedTrace(value, a.trace, b.trace, node);
	if (value === ABSENT) return { ...UNRESOLVED, trace };
	return { value, complete: same && a.complete && b.complete, trace };
}
