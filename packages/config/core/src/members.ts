import type { EnumValue, NodeSchema } from './schema.js';

const isUnion = (schema: NodeSchema): boolean => schema.kind === 'union';

/**
 * The unions nested in a union that have not been visited yet. Unions may refer to one another
 * through definitions (`A = number | B`, `B = string | A`), so every walk over nested unions visits
 * each one once.
 */
export function nestedUnions(union: NodeSchema, seen: Set<NodeSchema>): NodeSchema[] {
	seen.add(union);
	return (union.anyOf ?? []).filter((member) => isUnion(member) && !seen.has(member));
}

/**
 * Members of nested unions take part directly: a union is a set of alternatives, never a
 * runtime kind of its own, so `A | (B | C)` must accept exactly what `A | B | C` accepts.
 */
export function flatMembers(union: NodeSchema, seen = new Set<NodeSchema>()): NodeSchema[] {
	if (seen.has(union)) return [];
	seen.add(union);
	return (union.anyOf ?? []).flatMap((member) => (isUnion(member) ? flatMembers(member, seen) : [member]));
}

/** The discriminator of the union itself, or the one every nested union agrees on. */
export function discriminatorOf(union: NodeSchema, seen = new Set<NodeSchema>()): string | undefined {
	if (union.discriminator !== undefined) return union.discriminator;
	const nested = nestedUnions(union, seen).map((member) => discriminatorOf(member, seen));
	const [first] = nested;
	return nested.length > 0 && nested.every((key) => key === first) ? first : undefined;
}

export function discriminatorValues(member: NodeSchema, key: string): readonly EnumValue[] {
	const properties = member.properties ?? {};
	return (Object.hasOwn(properties, key) ? properties[key]?.enum : undefined) ?? [];
}
