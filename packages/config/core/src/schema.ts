import type { Coverage } from '@chartguard/core';

export type SchemaKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'function' | 'any';
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
