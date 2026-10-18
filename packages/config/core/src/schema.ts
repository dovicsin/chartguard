import type { Coverage } from '@chartguard/core';

export type SchemaKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'function' | 'union' | 'any';
export type EnumValue = string | number | boolean;
/** 'warn' is correct while the schema is incomplete or extensible. */
export type AdditionalProperties = 'allow' | 'warn' | 'deny';

export interface NodeSchema {
	readonly kind: SchemaKind;
	readonly properties?: Readonly<Record<string, NodeSchema>>;
	readonly element?: NodeSchema;
	readonly required?: readonly string[];
	readonly enum?: readonly EnumValue[];
	readonly additionalProperties?: AdditionalProperties;
	/** Object: schema for keys not listed in `properties` (a record of caller-chosen keys). */
	readonly values?: NodeSchema;
	/** Union members; a value is checked against the member matching its runtime kind. */
	readonly anyOf?: readonly NodeSchema[];
	/** Union: property whose literal value selects among object members. */
	readonly discriminator?: string;
	/** Union: index into `anyOf` used when the discriminator is absent. */
	readonly defaultVariant?: number;
	/** Union: unknown discriminator values may be registered by plugins, so they are not errors. */
	readonly extensible?: boolean;
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
}

export interface ObjectOptions {
	readonly additional?: AdditionalProperties;
	readonly required?: readonly string[];
}

export interface UnionOptions {
	readonly discriminator?: string;
	readonly defaultVariant?: number;
	readonly extensible?: boolean;
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
