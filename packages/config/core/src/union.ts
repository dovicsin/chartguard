import { isContainer, ownDataProperty } from '@chartguard/core';

import { type Carried, carriedBy, isLikely, withCarried } from './carried.js';
import { decide } from './decide.js';
import type { ResolvedExtensions } from './extensions.js';
import { inheritedValue } from './inherited.js';
import { isPlainData, kindOf } from './kind.js';
import { discriminatorOf, discriminatorValues, flatMembers, nestedUnions } from './members.js';
import { mergeArrays, mergePrimitives } from './merge.js';
import { type Registration, registration, type Registries } from './registry.js';
import type { EnumValue, NodeSchema, RegistryRef } from './schema.js';
import { subsumingMember } from './subsume.js';

/** A claim the selection makes rests on a member that is only likely: its finding is too (`inferred`, H5). */
export type Selection = Choice & { readonly inferred?: boolean };

type Choice =
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

/** The member a `defaultFrom` names; ambiguous when the value cannot be read or names no member. */
function inheritedDefault(union: NodeSchema, { root, extensions }: DefaultContext): Selection | undefined {
	if (union.defaultFrom === undefined) return undefined;
	const inherited = inheritedValue(union.defaultFrom, root);
	const key = discriminatorOf(union);
	if (inherited === undefined || key === undefined) return AMBIGUOUS;
	// A plugin's variant is a member like a built-in one (CG-02-05): `chart.type: 'flame3d'` names it.
	const named =
		flatMembers(union).find((member) => discriminatorValues(member, key).some((known) => known === inherited.value)) ??
		extensionVariant(union, inherited.value, extensions);
	return named === undefined ? AMBIGUOUS : variant(named);
}

/** What a default may consult besides the value: the whole config, and the plugins' variants. */
interface DefaultContext {
	readonly root: unknown;
	readonly extensions: ResolvedExtensions | undefined;
}

/**
 * The union's own default for this value: the first `defaultWhen` rule that passes, else the
 * variant `defaultFrom` names, else `defaultVariant`, else the first default a nested union
 * declares. Ambiguous as soon as a rule cannot be decided before one passes: guessing would check
 * the value against the wrong variant.
 */
function defaultOf(
	union: NodeSchema,
	value: object,
	context: DefaultContext,
	seen = new Set<NodeSchema>()
): Selection | undefined {
	for (const rule of union.defaultWhen ?? []) {
		const decision = decide(rule, value);
		if (decision === undefined) return AMBIGUOUS;
		if (decision) return memberAt(union, rule.variant);
	}
	const inherited = inheritedDefault(union, context);
	if (inherited !== undefined) return inherited;
	if (union.defaultVariant !== undefined) return memberAt(union, union.defaultVariant);
	for (const member of nestedUnions(union, seen)) {
		const fallback = defaultOf(member, value, context, seen);
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
/** The variant point of a union, or the one every nested union that names one agrees on. */
function pointOf(union: NodeSchema, seen = new Set<NodeSchema>()): string | undefined {
	if (union.extensionPoint !== undefined) return union.extensionPoint;
	const nested = nestedUnions(union, seen).flatMap((member) => pointOf(member, seen) ?? []);
	const [first] = nested;
	return first !== undefined && nested.every((point) => point === first) ? first : undefined;
}

/** The variant a plugin extension adds under this value at the union's variant point, if any. */
function extensionVariant(
	union: NodeSchema,
	value: unknown,
	extensions: ResolvedExtensions | undefined
): NodeSchema | undefined {
	const point = pointOf(union);
	const ref = registryOf(union);
	if (point === undefined || ref === undefined || typeof value !== 'string') return undefined;
	return extensions?.variants.get(point)?.get(`${ref.prefix}${value}`);
}

function registryOf(union: NodeSchema, seen = new Set<NodeSchema>()): RegistryRef | undefined {
	if (union.registry !== undefined) return union.registry;
	const nested = nestedUnions(union, seen).flatMap((member) => registryOf(member, seen) ?? []);
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
function isExtensible(union: NodeSchema, seen = new Set<NodeSchema>()): boolean {
	return union.extensible === true || nestedUnions(union, seen).some((member) => isExtensible(member, seen));
}

/** The member an explicit discriminator value selects, as the caller's registry and the schema decide. */
/** A union whose object members are told apart by the literal values of `key`. */
interface Discriminated {
	readonly union: NodeSchema;
	readonly members: readonly NodeSchema[];
	readonly key: string;
}

function selectExplicit(value: unknown, { union, members, key }: Discriminated, context: SelectionContext): Selection {
	const { registries } = context;
	const ref = registryOf(union);
	const selected =
		members.find((member) => discriminatorValues(member, key).some((known) => known === value)) ??
		extensionVariant(union, value, context.extensions);
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
	/** Plugin variants by registry, consulted for a discriminator value no built-in member has. */
	readonly extensions?: ResolvedExtensions | undefined;
}

function selectByDiscriminator(
	value: object,
	union: NodeSchema,
	members: readonly NodeSchema[],
	{ registries, root, extensions }: SelectionContext
): Selection {
	const key = discriminatorOf(union);
	// A member without literal values for the key can never be told apart: do not guess.
	if (key === undefined || members.some((member) => discriminatorValues(member, key).length === 0)) return AMBIGUOUS;
	const entry = ownDataProperty(value, key);
	if (!entry.found && entry.accessor) return AMBIGUOUS;
	if (!entry.found || entry.value === undefined)
		return checkDefault(defaultOf(union, value, { root, extensions }) ?? AMBIGUOUS, key, registryOf(union), registries);
	return selectExplicit(entry.value, { union, members, key }, { registries, root, extensions });
}

/**
 * A plain object is never a platform object (`host`): when a plain member also fits, the platform
 * members are left out, so a data item is checked against its own shape (K2). Where only platform
 * members fit, they stay (a runtime may duck-type them); a class instance may be either.
 */
function byPlainness(value: unknown, matching: readonly NodeSchema[]): NodeSchema[] {
	if (!isPlainData(value)) return [...matching];
	const plain = matching.filter((member) => member.host === undefined);
	return plain.length > 0 ? plain : [...matching];
}

/**
 * The variant a `selectWhen` rule selects, applied before the discriminator as the runtime does; an
 * undecidable rule (a getter, a value only coercion decides) leaves the value ambiguous.
 */
function selectedByRules(union: NodeSchema, value: object): Selection | undefined {
	for (const rule of union.selectWhen ?? []) {
		const decision = decide(rule, value);
		if (decision === undefined) return AMBIGUOUS;
		if (decision) return memberAt(union, rule.variant);
	}
	return undefined;
}

/** The members the discriminator chooses among: those a `selectWhen` rule selects are told apart by it. */
function withoutRuled(union: NodeSchema, members: readonly NodeSchema[]): NodeSchema[] {
	const ruled = new Set((union.selectWhen ?? []).map(({ variant: index }) => union.anyOf?.[index]));
	return members.filter((member) => !ruled.has(member));
}

const subsumers = new WeakMap<NodeSchema, Map<string, NodeSchema | null>>();

/** The member subsuming the others (`subsumingMember`), computed once per union and set of members. */
function subsumerOf(union: NodeSchema, members: readonly NodeSchema[]): NodeSchema | undefined {
	const all = flatMembers(union);
	const key = members.map((member) => all.indexOf(member)).join(',');
	const known = subsumers.get(union) ?? new Map<string, NodeSchema | null>();
	subsumers.set(union, known);
	// Each member as it applies, with the tier the nested unions give it: a likely one is never subsumed by a confirmed one.
	const carried = carriedBy(union);
	if (!known.has(key))
		known.set(key, subsumingMember(members.map((member) => withCarried(member, carried.get(member)))) ?? null);
	return known.get(key) ?? undefined;
}

/** Selections that claim the value is wrong: they rest on every member of the union. */
const CLAIMS: ReadonlySet<Selection['kind']> = new Set([
	'mismatch',
	'unknown-variant',
	'invalid-variant',
	'unregistered'
]);

/**
 * Chooses the union member that applies to a value, without guessing between look-alike objects. A
 * finding is as strong as the weakest schema fact it rests on: a chosen member keeps the tier and
 * handler of the nested unions around it, and a claim that the value is wrong is likely when any
 * member is (H5).
 */
export function selectVariant(
	value: unknown,
	union: NodeSchema,
	context: SelectionContext = { registries: new Map(), root: undefined }
): Selection {
	const carried = carriedBy(union);
	const selection = chooseVariant(value, union, context, carried);
	if (selection.kind === 'variant') return variant(withCarried(selection.schema, carried.get(selection.schema)));
	if (!CLAIMS.has(selection.kind) || !flatMembers(union).some((member) => isLikely(member, carried))) return selection;
	return { ...selection, inferred: true };
}

/** The object member that applies: a `selectWhen` rule, the discriminator, the only fit, or one subsuming the others. */
function selectObject(
	value: object,
	union: NodeSchema,
	matching: readonly NodeSchema[],
	context: SelectionContext
): Selection {
	const ruled = selectedByRules(union, value);
	if (ruled !== undefined) return ruled;
	if (discriminatorOf(union) !== undefined)
		return selectByDiscriminator(value, union, withoutRuled(union, matching), context);
	const [only] = matching;
	if (matching.length === 1 && only !== undefined) return variant(only);
	const subsuming = subsumerOf(union, matching);
	return subsuming === undefined ? AMBIGUOUS : variant(subsuming);
}

function chooseVariant(
	value: unknown,
	union: NodeSchema,
	context: SelectionContext,
	carried: ReadonlyMap<NodeSchema, Carried>
): Selection {
	const members = flatMembers(union);
	// A union with no member of its own (only itself, H6) describes nothing: it claims nothing.
	if (members.length === 0 || members.some((member) => member.kind === 'any')) return ACCEPTED;
	const actual = kindOf(value);
	const matching = byPlainness(
		value,
		members.filter((member) => member.kind === actual)
	);
	const [only] = matching;
	if (only === undefined)
		return { kind: 'mismatch', expected: [...new Set(members.map((member) => member.kind))].join(' | ') };
	// Objects go through the discriminator even when only one member fits: an extensible registry
	// with a single built-in variant must still treat unknown variants as unresolved, not as errors.
	if (isContainer(value) && actual !== 'array') return selectObject(value, union, matching, context);
	if (matching.length === 1) return variant(only);
	const likely = matching.some((member) => isLikely(member, carried));
	return variant(actual === 'array' ? mergeArrays(matching, likely) : mergePrimitives(matching, likely));
}
