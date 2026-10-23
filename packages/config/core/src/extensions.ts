import { isRecord } from '@chartguard/core';

import {
	catalogVariantPoint,
	isSchema,
	resolveVariant,
	type VariantSpec,
	type VariantUnion
} from './extension-variants.js';
import type { NodeSchema, SchemaManifest } from './schema.js';

export type { VariantSpec } from './extension-variants.js';

/**
 * A plugin's options and variants, supplied by its author or user (CG-02-05). `options` adds named
 * options at an extension point (`chartjs.plugins`: `options.plugins.<name>`); `variants` adds
 * discriminated variants at a variant point, under their registered names (`echarts`:
 * `series.wordCloud`), as a schema or as a built-in they extend.
 */
export interface Extension {
	readonly id: string;
	readonly options?: Readonly<Record<string, Readonly<Record<string, NodeSchema>>>>;
	readonly variants?: Readonly<Record<string, Readonly<Record<string, VariantSpec>>>>;
}

/** Extensions resolved against a schema: what the walk consults where a built-in has no answer. */
export interface ResolvedExtensions {
	/** The extensions as given, in order: a further `withExtensions` resolves them again with its own. */
	readonly list: readonly Extension[];
	/** Extension point → option name → schema. */
	readonly options: ReadonlyMap<string, ReadonlyMap<string, NodeSchema>>;
	/** Variant point → registered name (`series.wordCloud`) → schema, its discriminator literal included. */
	readonly variants: ReadonlyMap<string, ReadonlyMap<string, NodeSchema>>;
}

/** Extensions that break the precedence policy; every problem is listed. A setup error, never a finding. */
export class ExtensionError extends Error {
	override readonly name = 'ExtensionError';
	constructor(readonly problems: readonly string[]) {
		super(`Extensions refused:\n${problems.join('\n')}`);
	}
}

/** What a schema offers extensions: its option points with their built-in names, its variant points with their unions. */
interface Catalog {
	readonly points: Map<string, Set<string>>;
	readonly registries: Map<string, VariantUnion[]>;
}

function catalogNode(node: NodeSchema, catalog: Catalog): void {
	if (node.extensionPoint === undefined) return;
	if (node.kind === 'object') {
		const names = catalog.points.get(node.extensionPoint) ?? new Set<string>();
		for (const name of Object.keys(node.properties ?? {})) names.add(name);
		catalog.points.set(node.extensionPoint, names);
	}
	catalogVariantPoint(node, catalog.registries);
}

function catalogOf(root: NodeSchema): Catalog {
	const catalog: Catalog = { points: new Map(), registries: new Map() };
	const seen = new Set<NodeSchema>();
	const pending = [root];
	for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
		if (seen.has(node)) continue;
		seen.add(node);
		catalogNode(node, catalog);
		pending.push(...(node.anyOf ?? []), ...Object.values(node.properties ?? {}));
		if (node.element !== undefined) pending.push(node.element);
		if (node.values !== undefined) pending.push(node.values);
	}
	return catalog;
}

/** Who defines what, per place (a point or a registry): name → the owning extension ids and the schema. */
type Owners = Map<string, Map<string, { ids: string[]; schema: NodeSchema }>>;

/** One extension's claim on a name at a place. */
interface Claim {
	readonly id: string;
	readonly name: string;
	readonly schema: NodeSchema;
}

function own(owners: Owners, place: string, { id, name, schema }: Claim): void {
	const names = owners.get(place) ?? new Map<string, { ids: string[]; schema: NodeSchema }>();
	const entry = names.get(name);
	if (entry === undefined) names.set(name, { ids: [id], schema });
	else entry.ids.push(id);
	owners.set(place, names);
}

function known(keys: Iterable<string>): string {
	// Code-unit order, never the locale's (D13); the keys of a map are distinct.
	const names = [...keys].sort((a, b) => (a < b ? -1 : 1));
	return names.length === 0 ? 'none' : names.join(', ');
}

/**
 * The entries of a part of an extension: an absent part has none; anything but a plain object is a
 * problem, never a raw `TypeError` and never silently nothing (K14).
 */
function entriesOf(value: unknown, problem: string, problems: string[]): [string, unknown][] {
	if (value === undefined) return [];
	if (isRecord(value)) return Object.entries(value);
	problems.push(problem);
	return [];
}

function addOptions(extension: Extension, catalog: Catalog, owners: Owners, problems: string[]): void {
	const points = entriesOf(
		extension.options,
		`${extension.id}: options must be an object of extension points`,
		problems
	);
	for (const [point, list] of points) {
		const entries = entriesOf(
			list,
			`${extension.id}: the options at ${point} must be an object of schemas by name`,
			problems
		);
		const builtIn = catalog.points.get(point);
		if (builtIn === undefined) {
			problems.push(`${extension.id}: no extension point ${point} (known: ${known(catalog.points.keys())})`);
			continue;
		}
		for (const [name, schema] of entries) {
			if (builtIn.has(name))
				problems.push(`${extension.id}: "${name}" is a built-in option of ${point} and cannot be replaced`);
			else if (!isSchema(schema)) problems.push(`${extension.id}: option "${name}" at ${point} is not a schema`);
			else own(owners, point, { id: extension.id, name, schema });
		}
	}
}

function addVariants(extension: Extension, catalog: Catalog, owners: Owners, problems: string[]): void {
	const registries = entriesOf(
		extension.variants,
		`${extension.id}: variants must be an object of registries`,
		problems
	);
	for (const [registry, list] of registries) {
		const entries = entriesOf(
			list,
			`${extension.id}: the variants of ${registry} must be an object of schemas by name`,
			problems
		);
		const unions = catalog.registries.get(registry);
		if (unions === undefined) {
			problems.push(`${extension.id}: no registry ${registry} (known: ${known(catalog.registries.keys())})`);
			continue;
		}
		for (const [name, schema] of entries) {
			const resolved = resolveVariant(registry, unions, name, schema);
			if (typeof resolved === 'string') problems.push(`${extension.id}: ${resolved}`);
			else own(owners, registry, { id: extension.id, name, schema: resolved });
		}
	}
}

/** Owners as lookup tables; a name owned twice is a problem naming both owners. */
function tables(owners: Owners, relation: string, problems: string[]): Map<string, Map<string, NodeSchema>> {
	const result = new Map<string, Map<string, NodeSchema>>();
	for (const [place, names] of owners) {
		const table = new Map<string, NodeSchema>();
		for (const [name, { ids, schema }] of names) {
			if (ids.length > 1) problems.push(`${ids.join(', ')}: both define "${name}" ${relation} ${place}`);
			table.set(name, schema);
		}
		result.set(place, table);
	}
	return result;
}

/** Where the extensions' claims are collected. */
interface Collected {
	readonly catalog: Catalog;
	readonly optionOwners: Owners;
	readonly variantOwners: Owners;
}

function addAll(
	list: readonly unknown[],
	{ catalog, optionOwners, variantOwners }: Collected,
	problems: string[]
): void {
	for (const extension of list) {
		if (!isRecord(extension)) problems.push('an extension must be an object with a non-empty id');
		else if (typeof extension['id'] !== 'string' || extension['id'] === '')
			problems.push('an extension needs a non-empty id');
		else {
			// Its parts are checked as they are read: a part of the wrong shape is a problem.
			const checked = extension as unknown as Extension;
			addOptions(checked, catalog, optionOwners, problems);
			addVariants(checked, catalog, variantOwners, problems);
		}
	}
}

/**
 * The manifest with `extensions` added to whatever it already has, checked against the
 * precedence policy (docs/specs/CG-02-05): built-ins cannot be replaced, a name has one owner,
 * only declared points and registries. The schema itself is never copied or changed.
 */
export function withExtensions(manifest: SchemaManifest, extensions: readonly Extension[]): SchemaManifest {
	// A caller without types may pass anything.
	const given: unknown = extensions;
	if (!Array.isArray(given)) throw new ExtensionError(['extensions must be a list']);
	const list = [...(manifest.extensions?.list ?? []), ...extensions];
	const problems: string[] = [];
	const optionOwners: Owners = new Map();
	const variantOwners: Owners = new Map();
	addAll(list, { catalog: catalogOf(manifest.root), optionOwners, variantOwners }, problems);
	const options = tables(optionOwners, 'at', problems);
	const variants = tables(variantOwners, 'in', problems);
	if (problems.length > 0) throw new ExtensionError(problems);
	return { ...manifest, extensions: { list, options, variants } };
}
