import type { NodeSchema } from './schema.js';

/**
 * A plugin variant (CG-02-05): a schema, or a built-in variant of the same point it extends, with
 * the properties it adds or redefines for itself (the built-in variant is never changed).
 */
export type VariantSpec = NodeSchema | { readonly extends: string; readonly schema?: NodeSchema };

/** One union open to variants at a point: its registry prefix, discriminator, and built-in variants by registered name. */
export interface VariantUnion {
	readonly prefix: string;
	readonly discriminator: string;
	readonly builtIn: ReadonlyMap<string, NodeSchema>;
}

/** Built-in members by the literal they declare for `key`, through nested unions (`T | T[]`). */
function membersOf(member: NodeSchema, key: string, seen: Set<NodeSchema>): [string, NodeSchema][] {
	if (seen.has(member)) return [];
	seen.add(member);
	if (member.kind === 'union') return (member.anyOf ?? []).flatMap((nested) => membersOf(nested, key, seen));
	return (member.properties?.[key]?.enum ?? []).map((literal) => [String(literal), member]);
}

/** Records a union that is open to variants: it names its point and has a registry and a discriminator. */
export function catalogVariantPoint(node: NodeSchema, points: Map<string, VariantUnion[]>): void {
	const { extensionPoint, registry, discriminator } = node;
	if (node.kind !== 'union' || extensionPoint === undefined || registry === undefined || discriminator === undefined)
		return;
	const builtIn = new Map(
		membersOf(node, discriminator, new Set()).map(([literal, member]) => [`${registry.prefix}${literal}`, member])
	);
	points.set(extensionPoint, [
		...(points.get(extensionPoint) ?? []),
		{ prefix: registry.prefix, discriminator, builtIn }
	]);
}

export const isSchema = (value: unknown): value is NodeSchema =>
	typeof value === 'object' && value !== null && typeof (value as { kind?: unknown }).kind === 'string';

/** The variant schema with its discriminator literal, or the problem that keeps it out. */
function withDiscriminator(name: string, schema: unknown, union: VariantUnion): NodeSchema | string {
	if (!isSchema(schema) || schema.kind !== 'object') return `variant "${name}" must be an object schema`;
	const value = name.slice(union.prefix.length);
	const declared = schema.properties?.[union.discriminator]?.enum;
	if (declared !== undefined && (declared.length !== 1 || declared[0] !== value))
		return `variant "${name}" declares ${union.discriminator} "${declared.map(String).join('", "')}", not "${value}"`;
	const literal: NodeSchema = { kind: 'string', enum: [value] };
	return { ...schema, properties: { ...schema.properties, [union.discriminator]: literal } };
}

/**
 * A built-in variant with an extension's properties added: a new node; the built-in is shared and
 * never changed. The result is the extension's own variant, so a property it declares is its own,
 * also one the built-in declares (a plugin dataset reads its `data` its own way); the built-in variant
 * keeps its own (A32).
 */
function inherit(base: NodeSchema, added: unknown, discriminator: string): NodeSchema | string {
	if (added !== undefined && (!isSchema(added) || added.kind !== 'object')) return 'must be an object schema';
	const properties = Object.fromEntries(Object.entries(base.properties ?? {}).filter(([key]) => key !== discriminator));
	const extra = isSchema(added) ? added : undefined;
	const required = [...new Set([...(base.required ?? []), ...(extra?.required ?? [])])].filter(
		(key) => key !== discriminator
	);
	return { ...base, properties: { ...properties, ...extra?.properties }, required };
}

const isExtending = (spec: unknown): spec is { readonly extends: unknown; readonly schema?: unknown } =>
	typeof spec === 'object' && spec !== null && 'extends' in spec;

/** The schema an extension's variant `name` resolves to at `point`, or the problem that refuses it. */
export function resolveVariant(
	point: string,
	unions: readonly VariantUnion[],
	name: string,
	spec: unknown
): NodeSchema | string {
	const union = unions.find(({ prefix }) => name.startsWith(prefix) && name.length > prefix.length);
	if (union === undefined)
		return `"${name}" has none of the prefixes of ${point} (${unions.map(({ prefix }) => prefix).join(', ')})`;
	if (union.builtIn.has(name)) return `"${name}" is a built-in variant of ${point} and cannot be replaced`;
	if (!isExtending(spec)) return withDiscriminator(name, spec, union);
	const base = typeof spec.extends === 'string' ? union.builtIn.get(spec.extends) : undefined;
	if (base === undefined)
		return `"${name}" extends "${String(spec.extends)}", which is not a built-in variant of ${point}`;
	const merged = inherit(base, spec.schema, union.discriminator);
	return typeof merged === 'string' ? `variant "${name}" ${merged}` : withDiscriminator(name, merged, union);
}
