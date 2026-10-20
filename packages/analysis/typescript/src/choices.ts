import { isContainer, isRecord, ownDataProperty } from '@chartguard/core';

import { type Decoded, known, UNRESOLVED } from './decoded.js';

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

/**
 * Either of two values, when which one is not known: only what both agree on is kept (A3 gaps for
 * the rest), and the result is complete only when both are complete and equal (CG-03-05).
 */
export function agreement(a: Decoded, b: Decoded): Decoded {
	const { value, same } = common(a.value, b.value);
	return value === ABSENT ? UNRESOLVED : { value, complete: same && a.complete && b.complete };
}
