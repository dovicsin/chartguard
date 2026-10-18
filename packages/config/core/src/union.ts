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
	const key = union.discriminator;
	if (key === undefined) return AMBIGUOUS;
	const entry = ownDataProperty(value, key);
	if (!entry.found || entry.value === undefined) {
		const fallback = union.defaultVariant === undefined ? undefined : union.anyOf?.[union.defaultVariant];
		return fallback === undefined ? AMBIGUOUS : variant(fallback);
	}
	const selected = members.find((member) => discriminatorValues(member, key).some((known) => known === entry.value));
	if (selected !== undefined) return variant(selected);
	const known = members.flatMap((member) => discriminatorValues(member, key));
	return { kind: union.extensible === true ? 'unknown-variant' : 'invalid-variant', key, value: entry.value, known };
}

/** Chooses the union member that applies to a value, without guessing between look-alike objects. */
export function selectVariant(value: unknown, union: NodeSchema): Selection {
	const members = union.anyOf ?? [];
	if (members.some((member) => member.kind === 'any')) return ACCEPTED;
	const actual = kindOf(value);
	const matching = members.filter((member) => member.kind === actual);
	const [only] = matching;
	if (only === undefined)
		return { kind: 'mismatch', expected: [...new Set(members.map((member) => member.kind))].join(' | ') };
	if (matching.length === 1) return variant(only);
	if (actual === 'array') return variant(mergeArrays(matching));
	if (isContainer(value)) return selectByDiscriminator(value, union, matching);
	return variant(mergePrimitives(matching));
}
