export type { Extension, ResolvedExtensions, VariantSpec } from './extensions.js';
export { ExtensionError, withExtensions } from './extensions.js';
export * from './ir/index.js';
export { keySegment } from './paths.js';
export type { ConfigRule, Item, Read, RuleContext } from './rules.js';
export { itemsOf, readOwn } from './rules.js';
export type {
	AdditionalProperties,
	DefaultChoice,
	DefaultFrom,
	DefaultTest,
	Deprecation,
	EnumValue,
	Handler,
	NodeSchema,
	ObjectOptions,
	RegistryRef,
	SchemaKind,
	SchemaManifest,
	UnionOptions
} from './schema.js';
export { DEFAULT_TESTS, s } from './schema.js';
export { MAX_SCHEMA_DEPTH, MAX_SCHEMA_NODES, schemaProblems } from './schema-check.js';
export { validateConfig } from './validate.js';
export type { Compatibility, Version } from './version.js';
export { compatibility, parseVersion } from './version.js';
