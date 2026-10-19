import { type Diagnostic, isContainer, ownDataProperty, suggestion } from '@chartguard/core';

import { unresolved } from './diagnostics.js';
import type { NodeSchema, RegistryRef } from './schema.js';

/** One registry of the caller's runtime, as the engine reads it. */
interface Registry {
	readonly names: ReadonlySet<string>;
	readonly complete: boolean;
}

export type Registries = ReadonlyMap<string, Registry>;

export interface Registration {
	/** The name the runtime looks up (`dataZoom.slider`). */
	readonly name: string;
	readonly registered: boolean;
	/** Not registered, the registry is complete and the runtime looks the value up here: it rejects it. */
	readonly rejected: boolean;
	/** Registered values under the same prefix, for the hint. */
	readonly siblings: readonly string[];
}

/** Whether `value` of a union with `ref` is registered: `undefined` when the caller gave no context for it. */
export function registration(registries: Registries, ref: RegistryRef, value: string): Registration | undefined {
	const registry = registries.get(ref.id);
	if (registry === undefined) return undefined;
	const name = `${ref.prefix}${value}`;
	const registered = registry.names.has(name);
	const siblings = [...registry.names].filter((other) => other.startsWith(ref.prefix));
	return {
		name,
		registered,
		rejected: !registered && registry.complete && ref.enforced,
		siblings: siblings.map((other) => other.slice(ref.prefix.length))
	};
}

const ids = new WeakMap<NodeSchema, ReadonlySet<string>>();

function collectIds(schema: NodeSchema, into: Set<string>, seen: Set<NodeSchema>): void {
	if (seen.has(schema)) return;
	seen.add(schema);
	if (schema.registry !== undefined) into.add(schema.registry.id);
	const children = [...(schema.anyOf ?? []), ...Object.values(schema.properties ?? {})];
	if (schema.element !== undefined) children.push(schema.element);
	if (schema.values !== undefined) children.push(schema.values);
	for (const child of children) collectIds(child, into, seen);
}

/** Every registry id a schema uses; computed once per schema. */
function registryIds(root: NodeSchema): ReadonlySet<string> {
	let known = ids.get(root);
	if (known === undefined) {
		const collected = new Set<string>();
		collectIds(root, collected, new Set());
		known = collected;
		ids.set(root, known);
	}
	return known;
}

/** `names` as a list of strings, read without running getters; `undefined` when it is anything else. */
function namesOf(context: object): ReadonlySet<string> | undefined {
	const entry = ownDataProperty(context, 'names');
	if (!entry.found || !Array.isArray(entry.value)) return undefined;
	const names = new Set<string>();
	for (let index = 0; index < entry.value.length; index++) {
		const item = ownDataProperty(entry.value, String(index));
		if (!item.found || typeof item.value !== 'string') return undefined;
		names.add(item.value);
	}
	return names;
}

function readRegistry(context: unknown): Registry | undefined {
	if (!isContainer(context) || Array.isArray(context)) return undefined;
	const complete = ownDataProperty(context, 'complete');
	const names = namesOf(context);
	if (!complete.found || typeof complete.value !== 'boolean' || names === undefined) return undefined;
	return { names, complete: complete.value };
}

const MALFORMED = 'Registry context must map registry ids to { names: string[], complete: boolean }; ignored.';

export interface RegistryContextReading {
	readonly registries: Registries;
	readonly diagnostics: readonly Diagnostic[];
}

/**
 * Reads the caller's `registries` option. A malformed context is ignored as a whole and reported
 * once; an id the schema does not use is reported, so a typo never silently disables the check.
 */
export function readRegistries(input: unknown, root: NodeSchema): RegistryContextReading {
	if (input === undefined) return { registries: new Map(), diagnostics: [] };
	if (!isContainer(input) || Array.isArray(input))
		return { registries: new Map(), diagnostics: [unresolved('CFG_REGISTRY_CONTEXT', '$', MALFORMED)] };
	const registries = new Map<string, Registry>();
	for (const id of Object.keys(input)) {
		const entry = ownDataProperty(input, id);
		const registry = entry.found ? readRegistry(entry.value) : undefined;
		if (registry === undefined)
			return { registries: new Map(), diagnostics: [unresolved('CFG_REGISTRY_CONTEXT', '$', MALFORMED)] };
		registries.set(id, registry);
	}
	return { registries, diagnostics: unknownIds(registries, root) };
}

function unknownIds(registries: Registries, root: NodeSchema): Diagnostic[] {
	const known = [...registryIds(root)];
	return [...registries.keys()]
		.filter((id) => !known.includes(id))
		.map((id) => {
			const match = suggestion(id, known);
			const message = `Registry "${id}" is not used by this schema (known: ${known.length === 0 ? 'none' : known.join(', ')}); ignored.`;
			return {
				...unresolved('CFG_UNKNOWN_REGISTRY', '$', message),
				...(match === undefined ? {} : { suggestion: `Did you mean "${match}"?` })
			};
		});
}
