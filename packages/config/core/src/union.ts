import { isContainer, ownDataProperty } from '@chartguard/core';

import { kindOf } from './kind.js';
import type { EnumValue, NodeSchema } from './schema.js';

export type Selection =
	| { readonly kind: 'variant'; readonly schema: NodeSchema }
	| { readonly kind: 'accepted' }
	| { readonly kind: 'mismatch'; readonly expected: string }
	| { readonly kind: 'ambiguous' }
	| {
			readonly kind: 'unknown-variant' | 'invalid-variant';
			readonly key: string;
			readonly value: unknown;
			readonly known: readonly EnumValue[];
	  };

const ACCEPTED: Selection = { kind: 'accepted' };
const AMBIGUOUS: Selection = { kind: 'ambiguous' };

function variant(schema: NodeSchema): Selection {
	return { kind: 'variant', schema };
}

const isUnion = (schema: NodeSchema): boolean => schema.kind === 'union';

/**
 * Members of nested unions take part directly: a union is a set of alternatives, never a
 * runtime kind of its own, so `A | (B | C)` must accept exactly what `A | B | C` accepts.
 */
function flatMembers(union: NodeSchema): NodeSchema[] {
	return (union.anyOf ?? []).flatMap((member) => (isUnion(member) ? flatMembers(member) : [member]));
}

/** The discriminator of the union itself, or the one every nested union agrees on. */
function discriminatorOf(union: NodeSchema): string | undefined {
	if (union.discriminator !== undefined) return union.discriminator;
	const nested = (union.anyOf ?? []).filter(isUnion).map(discriminatorOf);
	const [first] = nested;
	return nested.length > 0 && nested.every((key) => key === first) ? first : undefined;
}

/** The union's own default variant, or the first one a nested union declares. */
function defaultOf(union: NodeSchema): NodeSchema | undefined {
	if (union.defaultVariant !== undefined) return union.anyOf?.[union.defaultVariant];
	for (const member of (union.anyOf ?? []).filter(isUnion)) {
		const fallback = defaultOf(member);
		if (fallback !== undefined) return fallback;
	}
	return undefined;
}

/** A union is extensible when it or any nested union that carries the discriminator says so. */
function isExtensible(union: NodeSchema): boolean {
	return union.extensible === true || (union.anyOf ?? []).filter(isUnion).some(isExtensible);
}

/** Same-kind primitives: any unrestricted member widens to the whole kind, otherwise enums merge. */
function mergePrimitives(members: readonly NodeSchema[]): NodeSchema {
	const [first] = members;
	const kind = first?.kind ?? 'any';
	if (members.some((member) => member.enum === undefined)) return { kind };
	return { kind, enum: members.flatMap((member) => member.enum ?? []) };
}

function mergeArrays(members: readonly NodeSchema[]): NodeSchema {
	const elements = members.map((member): NodeSchema => member.element ?? { kind: 'any' });
	return { kind: 'array', element: { kind: 'union', anyOf: elements } };
}

function discriminatorValues(member: NodeSchema, key: string): readonly EnumValue[] {
	const properties = member.properties ?? {};
	return (Object.hasOwn(properties, key) ? properties[key]?.enum : undefined) ?? [];
}

function selectByDiscriminator(value: object, union: NodeSchema, members: readonly NodeSchema[]): Selection {
	const key = discriminatorOf(union);
	// A member without literal values for the key can never be told apart: do not guess.
	if (key === undefined || members.some((member) => discriminatorValues(member, key).length === 0)) return AMBIGUOUS;
	const entry = ownDataProperty(value, key);
	if (!entry.found || entry.value === undefined) {
		const fallback = defaultOf(union);
		return fallback === undefined ? AMBIGUOUS : variant(fallback);
	}
	const selected = members.find((member) => discriminatorValues(member, key).some((known) => known === entry.value));
	if (selected !== undefined) return variant(selected);
	const known = members.flatMap((member) => discriminatorValues(member, key));
	return { kind: isExtensible(union) ? 'unknown-variant' : 'invalid-variant', key, value: entry.value, known };
}

/** Chooses the union member that applies to a value, without guessing between look-alike objects. */
export function selectVariant(value: unknown, union: NodeSchema): Selection {
	const members = flatMembers(union);
	if (members.some((member) => member.kind === 'any')) return ACCEPTED;
	const actual = kindOf(value);
	const matching = members.filter((member) => member.kind === actual);
	const [only] = matching;
	if (only === undefined)
		return { kind: 'mismatch', expected: [...new Set(members.map((member) => member.kind))].join(' | ') };
	if (actual === 'array') return matching.length === 1 ? variant(only) : variant(mergeArrays(matching));
	// Objects go through the discriminator even when only one member fits: an extensible registry
	// with a single built-in variant must still treat unknown variants as unresolved, not as errors.
	if (isContainer(value))
		return discriminatorOf(union) === undefined && matching.length === 1
			? variant(only)
			: selectByDiscriminator(value, union, matching);
	return matching.length === 1 ? variant(only) : variant(mergePrimitives(matching));
}
