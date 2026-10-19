import { isContainer, ownDataProperty } from '@chartguard/core';

import { inheritedValue } from './inherited.js';
import { isListLike, kindOf } from './kind.js';
import { type Registration, registration, type Registries } from './registry.js';
import type { DefaultChoice, DefaultTest, EnumValue, NodeSchema, RegistryRef } from './schema.js';

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
	  }
	/** Registered by the caller's runtime, unknown to the schema: an extension whose options are not checked. */
	| { readonly kind: 'registered'; readonly key: string; readonly value: string }
	/** Not in the caller's complete registry, so the runtime rejects it; `defaulted` when the runtime chose it. */
	| {
			readonly kind: 'unregistered';
			readonly key: string;
			readonly value: string;
			readonly defaulted: boolean;
			readonly registration: Registration;
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

/** `undefined`: the runtime decides this value only by coercion (`'3' > 0`), which is never run here. */
type Decision = boolean | undefined;

function nonEmpty(value: unknown): Decision {
	if (isListLike(value)) return value.length > 0;
	return Boolean(value) ? undefined : false;
}

function positive(value: unknown): Decision {
	if (typeof value === 'number') return value > 0;
	return Boolean(value) ? undefined : false;
}

const TESTS: Readonly<Record<DefaultTest, (value: unknown) => Decision>> = { truthy: Boolean, nonEmpty, positive };

/** An absent property is `undefined`, as the runtime reads it; a getter never runs, so it decides nothing. */
function decide(rule: DefaultChoice, value: object): Decision {
	const entry = ownDataProperty(value, rule.property);
	if (entry.found) return TESTS[rule.test](entry.value);
	return entry.accessor ? undefined : TESTS[rule.test](undefined);
}

/** The member a `defaultFrom` names; ambiguous when the value cannot be read or names no member. */
function inheritedDefault(union: NodeSchema, root: unknown): Selection | undefined {
	if (union.defaultFrom === undefined) return undefined;
	const inherited = inheritedValue(union.defaultFrom, root);
	const key = discriminatorOf(union);
	if (inherited === undefined || key === undefined) return AMBIGUOUS;
	const named = flatMembers(union).find((member) =>
		discriminatorValues(member, key).some((known) => known === inherited.value)
	);
	return named === undefined ? AMBIGUOUS : variant(named);
}

/**
 * The union's own default for this value: the first `defaultWhen` rule that passes, else the
 * variant `defaultFrom` names, else `defaultVariant`, else the first default a nested union
 * declares. Ambiguous as soon as a rule cannot be decided before one passes: guessing would check
 * the value against the wrong variant.
 */
function defaultOf(union: NodeSchema, value: object, root: unknown): Selection | undefined {
	for (const rule of union.defaultWhen ?? []) {
		const decision = decide(rule, value);
		if (decision === undefined) return AMBIGUOUS;
		if (decision) return memberAt(union, rule.variant);
	}
	const inherited = inheritedDefault(union, root);
	if (inherited !== undefined) return inherited;
	if (union.defaultVariant !== undefined) return memberAt(union, union.defaultVariant);
	for (const member of (union.anyOf ?? []).filter(isUnion)) {
		const fallback = defaultOf(member, value, root);
		if (fallback !== undefined) return fallback;
	}
	return undefined;
}

function memberAt(union: NodeSchema, index: number): Selection | undefined {
	const member = union.anyOf?.[index];
	return member === undefined ? undefined : variant(member);
}

const sameRegistry = (left: RegistryRef, right: RegistryRef): boolean =>
	left.id === right.id && left.prefix === right.prefix && left.enforced === right.enforced;

/** The registry of the union itself, or the one every nested union that names one agrees on. */
function registryOf(union: NodeSchema): RegistryRef | undefined {
	if (union.registry !== undefined) return union.registry;
	const nested = (union.anyOf ?? []).filter(isUnion).flatMap((member) => registryOf(member) ?? []);
	const [first] = nested;
	return first !== undefined && nested.every((ref) => sameRegistry(ref, first)) ? first : undefined;
}

/** What the caller's registry says about an explicit discriminator value; `undefined` leaves the usual rules. */
function byRegistration(
	found: Registration | undefined,
	selected: NodeSchema | undefined,
	key: string,
	value: string
): Selection | undefined {
	if (found === undefined) return undefined;
	if (found.registered) return selected === undefined ? { kind: 'registered', key, value } : variant(selected);
	return found.rejected ? { kind: 'unregistered', key, value, defaulted: false, registration: found } : undefined;
}

/** A default variant the runtime picks must be registered too: a complete registry without it is rejected. */
function checkDefault(
	selection: Selection,
	key: string,
	ref: RegistryRef | undefined,
	registries: Registries
): Selection {
	if (selection.kind !== 'variant' || ref === undefined) return selection;
	const [literal] = discriminatorValues(selection.schema, key).filter((value) => typeof value === 'string');
	if (typeof literal !== 'string') return selection;
	const found = registration(registries, ref, literal);
	if (found?.rejected !== true) return selection;
	return { kind: 'unregistered', key, value: literal, defaulted: true, registration: found };
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

/** The member an explicit discriminator value selects, as the caller's registry and the schema decide. */
/** A union whose object members are told apart by the literal values of `key`. */
interface Discriminated {
	readonly union: NodeSchema;
	readonly members: readonly NodeSchema[];
	readonly key: string;
}

function selectExplicit(value: unknown, { union, members, key }: Discriminated, registries: Registries): Selection {
	const selected = members.find((member) => discriminatorValues(member, key).some((known) => known === value));
	const ref = registryOf(union);
	if (ref !== undefined && typeof value === 'string') {
		const decided = byRegistration(registration(registries, ref, value), selected, key, value);
		if (decided !== undefined) return decided;
	}
	if (selected !== undefined) return variant(selected);
	const known = members.flatMap((member) => discriminatorValues(member, key));
	return { kind: isExtensible(union) ? 'unknown-variant' : 'invalid-variant', key, value, known };
}

/** What a selection may consult besides the value: the caller's registries and the whole config. */
export interface SelectionContext {
	readonly registries: Registries;
	readonly root: unknown;
}

function selectByDiscriminator(
	value: object,
	union: NodeSchema,
	members: readonly NodeSchema[],
	{ registries, root }: SelectionContext
): Selection {
	const key = discriminatorOf(union);
	// A member without literal values for the key can never be told apart: do not guess.
	if (key === undefined || members.some((member) => discriminatorValues(member, key).length === 0)) return AMBIGUOUS;
	const entry = ownDataProperty(value, key);
	if (!entry.found && entry.accessor) return AMBIGUOUS;
	if (!entry.found || entry.value === undefined)
		return checkDefault(defaultOf(union, value, root) ?? AMBIGUOUS, key, registryOf(union), registries);
	return selectExplicit(entry.value, { union, members, key }, registries);
}

/** Chooses the union member that applies to a value, without guessing between look-alike objects. */
export function selectVariant(
	value: unknown,
	union: NodeSchema,
	context: SelectionContext = { registries: new Map(), root: undefined }
): Selection {
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
			: selectByDiscriminator(value, union, matching, context);
	return matching.length === 1 ? variant(only) : variant(mergePrimitives(matching));
}
