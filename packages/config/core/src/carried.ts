import type { Handler, NodeSchema } from './schema.js';

/** What the nested unions on the way to a member state about it: their tier and their handler (H5). */
export interface Carried {
	readonly inferred: boolean;
	readonly handledBy?: Handler;
}

const carriedCache = new WeakMap<NodeSchema, ReadonlyMap<NodeSchema, Carried>>();

const carriedOf = (inferred: boolean, handledBy: Handler | undefined): Carried =>
	handledBy === undefined ? { inferred } : { inferred, handledBy };

/** A member reached on several ways is as weak as its weakest; differing handlers claim none. */
function joined(before: Carried | undefined, from: Carried): Carried {
	if (before === undefined) return from;
	return carriedOf(before.inferred || from.inferred, before.handledBy === from.handledBy ? from.handledBy : undefined);
}

function carry(into: Map<NodeSchema, Carried>, union: NodeSchema, from: Carried, seen: Set<NodeSchema>): void {
	seen.add(union);
	for (const member of union.anyOf ?? []) {
		if (member.kind !== 'union') into.set(member, joined(into.get(member), from));
		else if (!seen.has(member))
			carry(
				into,
				member,
				carriedOf(from.inferred || member.inferred === true, member.handledBy ?? from.handledBy),
				seen
			);
	}
}

/**
 * What every flattened member inherits from the nested unions around it. A union is a set of
 * alternatives, so flattening it must not drop what it states: a likely nested union (or the one-member
 * wrapper the lowering puts around a recursive reference, A31) leaves its members likely.
 */
export function carriedBy(union: NodeSchema): ReadonlyMap<NodeSchema, Carried> {
	const known = carriedCache.get(union);
	if (known !== undefined) return known;
	const found = new Map<NodeSchema, Carried>();
	carry(found, union, { inferred: false }, new Set());
	carriedCache.set(union, found);
	return found;
}

/** A member that is only likely, by its own tier or one carried to it. */
export const isLikely = (member: NodeSchema, carried: ReadonlyMap<NodeSchema, Carried>): boolean =>
	member.inferred === true || carried.get(member)?.inferred === true;

/** The member with what the nested unions around it state; the member itself unchanged when they add nothing. */
export function withCarried(member: NodeSchema, carried: Carried | undefined): NodeSchema {
	const inferred = carried?.inferred === true && member.inferred !== true;
	const handledBy = member.handledBy === undefined ? carried?.handledBy : undefined;
	if (!inferred && handledBy === undefined) return member;
	return { ...member, ...(inferred ? { inferred } : {}), ...(handledBy === undefined ? {} : { handledBy }) };
}
