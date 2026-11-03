import type { Coverage } from '@chartguard/core';

import type { DefaultChoice, DefaultFrom, Deprecation, Handler, RegistryRef } from '../schema.js';

/** The IR format version this engine reads; `checkArtifact` rejects an artifact with any other `irVersion`. */
export const SCHEMA_IR_VERSION = 1;

export const CONFIDENCE_TIERS = ['authoritative', 'derived', 'manual', 'unknown'] as const;
/**
 * How sure a schema fact is (CG-02-07): `authoritative` comes from the library's own pinned declarations and
 * yields confirmed findings; `derived` and `manual` only likely ones (warnings); `unknown` makes no claim.
 */
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** `closed`: unknown keys are wrong; `open`: documented extension point; `unknown`: not established. */
export const OPENNESS = ['closed', 'open', 'unknown'] as const;
/** Whether an object accepts keys it does not list; see `OPENNESS`. */
export type Openness = (typeof OPENNESS)[number];

export const SOURCE_KINDS = ['npm-package', 'docs-tree', 'manual'] as const;
/** Where a source comes from: a pinned npm package, a documentation tree or a hand-written entry. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** An upstream source schema facts are read from, keyed by id in `SchemaArtifact.sources`. */
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

/** A citation of a fact: `source` is a key of `SchemaArtifact.sources`. */
export interface SourceRef {
	readonly source: string;
	/** Where in the source, e.g. `ChartOptions.height`. */
	readonly pointer?: string;
}

/**
 * How sure a fact is and where it was read. `authoritative` needs at least one source, each with an
 * `integrity` pin (`checkArtifact`).
 */
export interface Provenance {
	readonly confidence: ConfidenceTier;
	readonly sources: readonly SourceRef[];
}

interface NodeBase {
	readonly provenance?: Provenance;
	readonly docs?: string;
}

/** A value of one primitive kind; `unknown` is a value whose shape is not established (checked as any). */
export interface PrimitiveNode extends NodeBase {
	readonly kind: 'string' | 'number' | 'boolean' | 'null' | 'function' | 'unknown';
}

/** Exactly one value; a union of same-typed literals lowers to an enum. */
export interface LiteralNode extends NodeBase {
	readonly kind: 'literal';
	readonly value: string | number | boolean | null;
}

export type { Deprecation } from '../schema.js';

/**
 * A named option of an object: its value, its own provenance (which covers the value and everything below it)
 * and the runtime facts about it. A property with `unknown` provenance is never required.
 */
export interface PropertyNode {
	readonly node: IrNode;
	readonly provenance: Provenance;
	readonly required?: boolean;
	readonly deprecated?: Deprecation;
	readonly docs?: string;
	/** The runtime handles this option only when a component or plugin is registered. */
	readonly handledBy?: Handler;
	/**
	 * The runtime reads this option as a list (one value is a list of one) and skips the values that
	 * are not objects of the kinds listed: given alone (`value`) or as a list entry (`entries`). Such a
	 * value has no effect; a kind not listed is one the runtime throws on (echarts components,
	 * `mappingToExists`, CG-02-10).
	 */
	readonly skips?: Skips;
}

/** A value that is not an object, by how a runtime tells it apart: `null`, a falsy primitive, any other primitive. */
export type SkippedKind = 'null' | 'falsy' | 'truthy';
export const SKIPPED_KINDS: ReadonlySet<string> = new Set<SkippedKind>(['null', 'falsy', 'truthy']);

/** The non-object values a list option's runtime skips, given alone (`value`) or as list entries (`entries`). */
export interface Skips {
	readonly value: readonly SkippedKind[];
	readonly entries: readonly SkippedKind[];
}

/**
 * An object with listed properties. `additional` decides unknown keys: only a `closed` object with
 * `authoritative` provenance rejects them; `open` accepts them; anything else warns.
 */
export interface ObjectNode extends NodeBase {
	readonly kind: 'object';
	readonly properties: Readonly<Record<string, PropertyNode>>;
	readonly additional: Openness;
	/** A point where plugins add named options (`chartjs.plugins`), for `withExtensions`. */
	readonly extensionPoint?: string;
	/** A `null` optional property counts as absent: the runtime reads options with `pick()`. */
	readonly nullAsAbsent?: boolean;
	/**
	 * A platform object of this class (`Date`, `CanvasGradient`, `HTMLElement`), opaque to the schema.
	 * A plain object is never one, so in a union it is checked against the plain members.
	 */
	readonly host?: string;
	/**
	 * Object definitions whose properties this object also accepts (one level; own properties win).
	 * Lets many objects share a large property set, e.g. Chart.js element options at every scope.
	 */
	readonly includes?: readonly string[];
}

/** Map with caller-chosen keys, e.g. Chart.js `scales`. */
export interface RecordNode extends NodeBase {
	readonly kind: 'record';
	readonly values: IrNode;
}

/** A list whose entries all match `items`. */
export interface ArrayNode extends NodeBase {
	readonly kind: 'array';
	readonly items: IrNode;
}

/**
 * A value matching one of `anyOf`, each member checked as the runtime tells them apart: by `discriminator`,
 * its defaults and `selectWhen` rules for object members.
 */
export interface UnionNode extends NodeBase {
	readonly kind: 'union';
	readonly anyOf: readonly IrNode[];
	/** Property whose literal value selects among object members. */
	readonly discriminator?: string;
	/** Index into `anyOf` used when the discriminator is absent and no `defaultWhen` rule applies. */
	readonly defaultVariant?: number;
	/**
	 * Conditional defaults for an absent discriminator, tried in order: the first rule whose
	 * property passes its test selects `variant` (ECharts axes: `data` truthy → category).
	 */
	readonly defaultWhen?: readonly DefaultRule[];
	/** When no `defaultWhen` rule passes, the variant named by a value elsewhere in the config (`chart.type`). */
	readonly defaultFrom?: DefaultFrom;
	/**
	 * Rules the runtime applies before it reads the discriminator, in order: the first whose property
	 * passes its test selects `variant` (ECharts `graphic`: with `elements` it is a component, whatever
	 * its `type`). A member only a rule selects needs no literal discriminator.
	 */
	readonly selectWhen?: readonly DefaultRule[];
	/** The variant registry can be extended (e.g. by plugins), so unknown variants are not errors. */
	readonly extensible?: boolean;
	/** The runtime registry the discriminator values live in (`echarts`, prefix `series.`); requires `extensible`. */
	readonly registry?: RegistryRef;
	/**
	 * Plugins may add variants to this union through `withExtensions`, keyed by its registry id,
	 * which this must equal. Unmarked registries (Chart.js controllers) take no variant extensions.
	 */
	readonly extensionPoint?: string;
}

/** A `defaultWhen` or `selectWhen` rule of a union; the IR name of `DefaultChoice`. */
export type DefaultRule = DefaultChoice;

/** A reference to `SchemaArtifact.definitions[ref]`; definitions may refer to themselves (recursive shapes). */
export interface RefNode extends NodeBase {
	readonly kind: 'ref';
	readonly ref: string;
}

/** A value or a callback producing it; callbacks are never evaluated. */
export interface ScriptableNode extends NodeBase {
	readonly kind: 'scriptable';
	readonly value: IrNode;
}

/** Any node of the schema IR, told apart by `kind`. */
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

/**
 * A generated schema (the IR): a versioned, provenance-carrying description of one exact version of a
 * library's options. Check it with `checkArtifact`, then turn it into an engine schema with `lowerArtifact`.
 */
export interface SchemaArtifact {
	readonly irVersion: typeof SCHEMA_IR_VERSION;
	readonly library: string;
	/** Exact upstream version, never a range. */
	readonly libraryVersion: string;
	readonly coverage: Coverage;
	readonly generator: { readonly name: string; readonly version: string };
	/**
	 * `sha256-<hex>` of the artifact text without this field. Identifies the exact schema a result
	 * came from: two artifacts for the same upstream version can differ when the generator changes.
	 */
	readonly digest?: string;
	readonly sources: Readonly<Record<string, SourceRecord>>;
	readonly definitions: Readonly<Record<string, IrNode>>;
	readonly root: IrNode;
}
