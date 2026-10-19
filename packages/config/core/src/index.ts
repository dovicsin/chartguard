export * from './ir/index.js';
export type {
	AdditionalProperties,
	EnumValue,
	NodeSchema,
	ObjectOptions,
	SchemaKind,
	SchemaManifest,
	UnionOptions
} from './schema.js';
export { s } from './schema.js';
export { validateConfig } from './validate.js';
export type { Compatibility, Version } from './version.js';
export { compatibility, parseVersion } from './version.js';
