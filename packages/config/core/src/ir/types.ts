import type { Coverage } from '@chartguard/core';

export const SCHEMA_IR_VERSION = 1;

export const CONFIDENCE_TIERS = ['authoritative', 'derived', 'manual', 'unknown'] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** `closed`: unknown keys are wrong; `open`: documented extension point; `unknown`: not established. */
export const OPENNESS = ['closed', 'open', 'unknown'] as const;
export type Openness = (typeof OPENNESS)[number];

export const SOURCE_KINDS = ['npm-package', 'docs-tree', 'manual'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceRecord {
	readonly kind: SourceKind;
	/** `package@version` or a URL. */
	readonly locator: string;
	/** npm `sha512-…` integrity or a content hash; required to back `authoritative` facts. */
	readonly integrity?: string;
	readonly license: string;
	/** Retrieval date for unversioned sources. */
	readonly retrieved?: string;
}

export interface SourceRef {
	readonly source: string;
	/** Where in the source, e.g. `ChartOptions.height`. */
	readonly pointer?: string;
}

export interface Provenance {
	readonly confidence: ConfidenceTier;
	readonly sources: readonly SourceRef[];
}

interface NodeBase {
	readonly provenance?: Provenance;
	readonly docs?: string;
}

export interface PrimitiveNode extends NodeBase {
	readonly kind: 'string' | 'number' | 'boolean' | 'null' | 'function' | 'unknown';
}

export interface LiteralNode extends NodeBase {
	readonly kind: 'literal';
	readonly value: string | number | boolean | null;
}

export interface Deprecation {
	readonly since?: string;
	readonly replacement?: string;
	readonly message?: string;
}

export interface PropertyNode {
	readonly node: IrNode;
	readonly provenance: Provenance;
	readonly required?: boolean;
	readonly deprecated?: Deprecation;
	readonly docs?: string;
}

export interface ObjectNode extends NodeBase {
	readonly kind: 'object';
	readonly properties: Readonly<Record<string, PropertyNode>>;
	readonly additional: Openness;
}

/** Map with caller-chosen keys, e.g. Chart.js `scales`. */
export interface RecordNode extends NodeBase {
	readonly kind: 'record';
	readonly values: IrNode;
}

export interface ArrayNode extends NodeBase {
	readonly kind: 'array';
	readonly items: IrNode;
}

export interface UnionNode extends NodeBase {
	readonly kind: 'union';
	readonly anyOf: readonly IrNode[];
	readonly discriminator?: string;
}

export interface RefNode extends NodeBase {
	readonly kind: 'ref';
	readonly ref: string;
}

/** A value or a callback producing it; callbacks are never evaluated. */
export interface ScriptableNode extends NodeBase {
	readonly kind: 'scriptable';
	readonly value: IrNode;
}

export type IrNode =
	PrimitiveNode | LiteralNode | ObjectNode | RecordNode | ArrayNode | UnionNode | RefNode | ScriptableNode;

export const NODE_KINDS: ReadonlySet<string> = new Set<IrNode['kind']>([
	'string',
	'number',
	'boolean',
	'null',
	'function',
	'unknown',
	'literal',
	'object',
	'record',
	'array',
	'union',
	'ref',
	'scriptable'
]);

export interface SchemaArtifact {
	readonly irVersion: typeof SCHEMA_IR_VERSION;
	readonly library: string;
	/** Exact upstream version, never a range. */
	readonly libraryVersion: string;
	readonly coverage: Coverage;
	readonly generator: { readonly name: string; readonly version: string };
	readonly sources: Readonly<Record<string, SourceRecord>>;
	readonly definitions: Readonly<Record<string, IrNode>>;
	readonly root: IrNode;
}
