import type { Coverage } from '@chartguard/core';

import type { ResolvedExtensions } from './extensions.js';

export type SchemaKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'function' | 'union' | 'any';
export type EnumValue = string | number | boolean;
/** 'warn' is correct while the schema is incomplete or extensible. */
export type AdditionalProperties = 'allow' | 'warn' | 'deny';

/**
 * How a `defaultWhen` rule reads its property, mirroring the runtime expression: `truthy` (`p ? …`),
 * `nonEmpty` (`p.length > 0` on a list) and `positive` (`p > 0` on a number).
 */
export const DEFAULT_TESTS = ['truthy', 'nonEmpty', 'positive'] as const;
export type DefaultTest = (typeof DEFAULT_TESTS)[number];

/** `variant` (an `anyOf` index) applies when `property` passes `test`. */
export interface DefaultChoice {
	readonly test: DefaultTest;
	readonly property: string;
	readonly variant: number;
}

/**
 * The runtime registry a union's discriminator values are registered in, each as `<prefix><value>`.
 * `enforced`: the runtime looks the value up right here, so a value missing from a complete registry
 * is rejected. Otherwise a registered extension is still recognised, but a missing value is left to
 * the usual rules (Chart.js reads the chart `type` only through its datasets, which enforce it).
 */
export interface RegistryRef {
	readonly id: string;
	readonly prefix: string;
	readonly enforced: boolean;
}

/**
 * An option the upstream deprecates. `replacement` names what to use instead; `renameTo` is set
 * only when the runtime itself copies the option into that sibling key, so renaming it there
 * cannot change what the runtime does.
 */
export interface Deprecation {
	readonly since?: string;
	readonly replacement?: string;
	readonly message?: string;
	readonly renameTo?: string;
}

/**
 * The runtime handles an option only when `name` (or a subtype, `name.<sub>`) is registered in
 * registry `id`. `enforced`: otherwise it rejects the option; else it ignores it (no effect).
 */
export interface Handler {
	readonly id: string;
	readonly name: string;
	readonly enforced: boolean;
}

/**
 * A default variant named elsewhere in the config: the value at `path` from the root (Highcharts
 * series take `chart.type`), or `fallback` when it is missing (the runtime's own default).
 */
export interface DefaultFrom {
	readonly path: readonly string[];
	readonly fallback: EnumValue;
}

export interface NodeSchema {
	readonly kind: SchemaKind;
	readonly properties?: Readonly<Record<string, NodeSchema>>;
	readonly element?: NodeSchema;
	readonly required?: readonly string[];
	readonly enum?: readonly EnumValue[];
	readonly additionalProperties?: AdditionalProperties;
	/**
	 * Object: a point where plugins add named options (`chartjs.plugins`). Union: its registry id,
	 * when plugins may add variants to it (`echarts`). See `withExtensions`.
	 */
	readonly extensionPoint?: string;
	/**
	 * The facts at and below this node are not authoritative (IR `derived` or `manual` provenance,
	 * or a curated or plugin schema that says so): its findings are likely problems, never
	 * confirmed ones (CG-02-07).
	 */
	readonly inferred?: true;
	/** Object: a `null` optional property counts as absent (the runtime reads options with `pick()`, Highcharts). */
	readonly nullAsAbsent?: boolean;
	/** Object: schema for keys not listed in `properties` (a record of caller-chosen keys). */
	readonly values?: NodeSchema;
	/** Union members; a value is checked against the member matching its runtime kind. */
	readonly anyOf?: readonly NodeSchema[];
	/** Union: property whose literal value selects among object members. */
	readonly discriminator?: string;
	/** Union: index into `anyOf` used when the discriminator is absent and no `defaultWhen` rule applies. */
	readonly defaultVariant?: number;
	/** Union: conditional defaults for an absent discriminator; the first rule that passes wins. */
	readonly defaultWhen?: readonly DefaultChoice[];
	/** Union: when no `defaultWhen` rule passes, the variant a value elsewhere in the config names. */
	readonly defaultFrom?: DefaultFrom;
	/** Union: unknown discriminator values may be registered by plugins, so they are not errors. */
	readonly extensible?: boolean;
	/** Union: where the runtime looks the discriminator value up; checked against the caller's registry context. */
	readonly registry?: RegistryRef;
	/** The value of an option the runtime handles only when this component or plugin is registered. */
	readonly handledBy?: Handler;
	/** The value of an option the upstream deprecates. */
	readonly deprecated?: Deprecation;
	readonly doc?: string;
}

export interface SchemaManifest {
	readonly library: string;
	readonly version: string;
	/** Content digest of the generated artifact, when the manifest was lowered from one. */
	readonly digest?: string;
	readonly coverage: Coverage;
	readonly root: NodeSchema;
	readonly source: string;
	/** Plugin options and variants the schema was extended with (`withExtensions`). */
	readonly extensions?: ResolvedExtensions;
}

export interface ObjectOptions {
	readonly additional?: AdditionalProperties;
	readonly required?: readonly string[];
}

export interface UnionOptions {
	readonly discriminator?: string;
	readonly defaultVariant?: number;
	readonly defaultWhen?: readonly DefaultChoice[];
	readonly defaultFrom?: DefaultFrom;
	readonly extensible?: boolean;
	readonly registry?: RegistryRef;
}

export const s = {
	object: (properties: Readonly<Record<string, NodeSchema>>, options: ObjectOptions = {}): NodeSchema => ({
		kind: 'object',
		properties,
		additionalProperties: options.additional ?? 'warn',
		required: options.required ?? []
	}),
	array: (element: NodeSchema): NodeSchema => ({ kind: 'array', element }),
	string: (values?: readonly string[]): NodeSchema =>
		values === undefined ? { kind: 'string' } : { kind: 'string', enum: values },
	number: (): NodeSchema => ({ kind: 'number' }),
	boolean: (): NodeSchema => ({ kind: 'boolean' }),
	func: (): NodeSchema => ({ kind: 'function' }),
	/** An empty union accepts nothing and is a programming error, not a schema. */
	union: (anyOf: readonly NodeSchema[], options: UnionOptions = {}): NodeSchema => {
		if (anyOf.length === 0) throw new Error('s.union needs at least one member');
		return { kind: 'union', anyOf, ...options };
	},
	any: (): NodeSchema => ({ kind: 'any' })
};
