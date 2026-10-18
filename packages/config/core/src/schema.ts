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
	readonly coverage: Coverage;
	readonly root: NodeSchema;
	readonly source: string;
}

export const s = {
	object: (
		properties: Readonly<Record<string, NodeSchema>>,
		additionalProperties: AdditionalProperties = 'warn',
		required: readonly string[] = []
	): NodeSchema => ({ kind: 'object', properties, additionalProperties, required }),
	array: (element: NodeSchema): NodeSchema => ({ kind: 'array', element }),
	string: (values?: readonly string[]): NodeSchema =>
		values === undefined ? { kind: 'string' } : { kind: 'string', enum: values },
	number: (): NodeSchema => ({ kind: 'number' }),
	boolean: (): NodeSchema => ({ kind: 'boolean' }),
	func: (): NodeSchema => ({ kind: 'function' }),
	any: (): NodeSchema => ({ kind: 'any' })
};
