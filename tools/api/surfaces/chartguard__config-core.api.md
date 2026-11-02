## @chartguard/config-core

### AdditionalProperties
type AdditionalProperties = 'allow' | 'warn' | 'deny';

### ArrayNode
interface ArrayNode extends NodeBase {
    readonly kind: 'array';
    readonly items: IrNode;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### ArtifactCheck
interface ArtifactCheck {
    readonly artifact: SchemaArtifact | undefined;
    readonly problems: readonly string[];
}

### Compatibility
type Compatibility = 'exact' | 'same-major' | 'other-major' | 'malformed';

### ConfidenceTier
type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];
// uses CONFIDENCE_TIERS
CONFIDENCE_TIERS: readonly [
    "authoritative",
    "derived",
    "manual",
    "unknown"
]

### ConfigRule
interface ConfigRule {
    readonly id: string;
    check(input: unknown, context: RuleContext): readonly Diagnostic[];
}

### DEFAULT_TESTS
DEFAULT_TESTS: readonly [
    "truthy",
    "nonEmpty",
    "positive"
]

### DefaultChoice
interface DefaultChoice {
    readonly test: DefaultTest;
    readonly property: string;
    readonly variant: number;
}

### DefaultFrom
interface DefaultFrom {
    readonly path: readonly string[];
    readonly fallback: EnumValue;
}

### DefaultRule
type DefaultRule = DefaultChoice;

### DefaultTest
type DefaultTest = (typeof DEFAULT_TESTS)[number];

### Deprecation
interface Deprecation {
    readonly since?: string;
    readonly replacement?: string;
    readonly message?: string;
    readonly renameTo?: string;
}

### EnumValue
type EnumValue = string | number | boolean;

### Extension
interface Extension {
    readonly id: string;
    readonly options?: Readonly<Record<string, Readonly<Record<string, NodeSchema>>>>;
    readonly variants?: Readonly<Record<string, Readonly<Record<string, VariantSpec>>>>;
}

### ExtensionError
class ExtensionError extends Error {
    readonly problems: readonly string[];
    readonly name = "ExtensionError";
    constructor(problems: readonly string[]);
}

### Handler
interface Handler {
    readonly id: string;
    readonly name: string;
    readonly enforced: boolean;
}

### IrNode
type IrNode = PrimitiveNode | LiteralNode | ObjectNode | RecordNode | ArrayNode | UnionNode | RefNode | ScriptableNode;

### Item
interface Item {
    readonly path: string;
    readonly index: number;
    readonly value: unknown;
}

### LiteralNode
interface LiteralNode extends NodeBase {
    readonly kind: 'literal';
    readonly value: string | number | boolean | null;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### LoweredSchema
interface LoweredSchema {
    readonly manifest: SchemaManifest;
    readonly lossy: readonly string[];
}

### NodeSchema
interface NodeSchema {
    readonly kind: SchemaKind;
    readonly properties?: Readonly<Record<string, NodeSchema>>;
    readonly element?: NodeSchema;
    readonly required?: readonly string[];
    readonly enum?: readonly EnumValue[];
    readonly additionalProperties?: AdditionalProperties;
    readonly extensionPoint?: string;
    readonly inferred?: true;
    readonly nullAsAbsent?: boolean;
    readonly host?: string;
    readonly values?: NodeSchema;
    readonly anyOf?: readonly NodeSchema[];
    readonly discriminator?: string;
    readonly defaultVariant?: number;
    readonly defaultWhen?: readonly DefaultChoice[];
    readonly selectWhen?: readonly DefaultChoice[];
    readonly defaultFrom?: DefaultFrom;
    readonly extensible?: boolean;
    readonly registry?: RegistryRef;
    readonly handledBy?: Handler;
    readonly deprecated?: Deprecation;
    readonly doc?: string;
}

### ObjectNode
interface ObjectNode extends NodeBase {
    readonly kind: 'object';
    readonly properties: Readonly<Record<string, PropertyNode>>;
    readonly additional: Openness;
    readonly extensionPoint?: string;
    readonly nullAsAbsent?: boolean;
    readonly host?: string;
    readonly includes?: readonly string[];
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### ObjectOptions
interface ObjectOptions {
    readonly additional?: AdditionalProperties;
    readonly required?: readonly string[];
}

### Openness
type Openness = (typeof OPENNESS)[number];
// uses OPENNESS
OPENNESS: readonly [
    "closed",
    "open",
    "unknown"
]

### PrimitiveNode
interface PrimitiveNode extends NodeBase {
    readonly kind: 'string' | 'number' | 'boolean' | 'null' | 'function' | 'unknown';
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### PropertyNode
interface PropertyNode {
    readonly node: IrNode;
    readonly provenance: Provenance;
    readonly required?: boolean;
    readonly deprecated?: Deprecation;
    readonly docs?: string;
    readonly handledBy?: Handler;
}

### Provenance
interface Provenance {
    readonly confidence: ConfidenceTier;
    readonly sources: readonly SourceRef[];
}

### Read
type Read = {
    readonly known: true;
    readonly value: unknown;
} | {
    readonly known: false;
};

### RecordNode
interface RecordNode extends NodeBase {
    readonly kind: 'record';
    readonly values: IrNode;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### RefNode
interface RefNode extends NodeBase {
    readonly kind: 'ref';
    readonly ref: string;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### RegistryRef
interface RegistryRef {
    readonly id: string;
    readonly prefix: string;
    readonly enforced: boolean;
}

### ResolvedExtensions
interface ResolvedExtensions {
    readonly list: readonly Extension[];
    readonly options: ReadonlyMap<string, ReadonlyMap<string, NodeSchema>>;
    readonly variants: ReadonlyMap<string, ReadonlyMap<string, NodeSchema>>;
}

### RuleContext
interface RuleContext {
    rejected(code: string, path: string, message: string, suggestion?: string): Diagnostic;
    warned(code: string, path: string, message: string, suggestion?: string): Diagnostic;
    registered(id: string, name: string): boolean | undefined;
}

### SCHEMA_IR_VERSION
SCHEMA_IR_VERSION = 1

### SchemaArtifact
interface SchemaArtifact {
    readonly irVersion: typeof SCHEMA_IR_VERSION;
    readonly library: string;
    readonly libraryVersion: string;
    readonly coverage: Coverage;
    readonly generator: {
        readonly name: string;
        readonly version: string;
    };
    readonly digest?: string;
    readonly sources: Readonly<Record<string, SourceRecord>>;
    readonly definitions: Readonly<Record<string, IrNode>>;
    readonly root: IrNode;
}

### SchemaKind
type SchemaKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'function' | 'union' | 'any';

### SchemaManifest
interface SchemaManifest {
    readonly library: string;
    readonly version: string;
    readonly digest?: string;
    readonly coverage: Coverage;
    readonly root: NodeSchema;
    readonly source: string;
    readonly extensions?: ResolvedExtensions;
    readonly documentation?: (path: string, config: unknown, deprecation: Deprecation) => string | undefined;
}

### ScriptableNode
interface ScriptableNode extends NodeBase {
    readonly kind: 'scriptable';
    readonly value: IrNode;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### SourceKind
type SourceKind = (typeof SOURCE_KINDS)[number];
// uses SOURCE_KINDS
SOURCE_KINDS: readonly [
    "npm-package",
    "docs-tree",
    "manual"
]

### SourceRecord
interface SourceRecord {
    readonly kind: SourceKind;
    readonly locator: string;
    readonly integrity?: string;
    readonly license: string;
    readonly retrieved?: string;
}

### SourceRef
interface SourceRef {
    readonly source: string;
    readonly pointer?: string;
}

### UnionNode
interface UnionNode extends NodeBase {
    readonly kind: 'union';
    readonly anyOf: readonly IrNode[];
    readonly discriminator?: string;
    readonly defaultVariant?: number;
    readonly defaultWhen?: readonly DefaultRule[];
    readonly defaultFrom?: DefaultFrom;
    readonly selectWhen?: readonly DefaultRule[];
    readonly extensible?: boolean;
    readonly registry?: RegistryRef;
    readonly extensionPoint?: string;
}
// uses NodeBase
interface NodeBase {
    readonly provenance?: Provenance;
    readonly docs?: string;
}

### UnionOptions
interface UnionOptions {
    readonly discriminator?: string;
    readonly defaultVariant?: number;
    readonly defaultWhen?: readonly DefaultChoice[];
    readonly defaultFrom?: DefaultFrom;
    readonly extensible?: boolean;
    readonly registry?: RegistryRef;
}

### VariantSpec
type VariantSpec = NodeSchema | {
    readonly extends: string;
    readonly schema?: NodeSchema;
};

### Version
interface Version {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: string | undefined;
}

### checkArtifact
function checkArtifact(value: unknown): ArtifactCheck;

### compatibility
function compatibility(schemaVersion: string, requested: string): Compatibility;

### itemsOf
function itemsOf(value: unknown, path: string): readonly Item[] | undefined;

### keySegment
function keySegment(key: string): string;

### lowerArtifact
function lowerArtifact(artifact: SchemaArtifact): LoweredSchema;

### manifestFromArtifact
function manifestFromArtifact(value: unknown): SchemaManifest;

### parseVersion
function parseVersion(text: string): Version | undefined;

### readOwn
function readOwn(value: unknown, ...path: readonly (string | number)[]): Read;

### s
s: {
    object: (properties: Readonly<Record<string, NodeSchema>>, options?: ObjectOptions) => NodeSchema;
    array: (element: NodeSchema) => NodeSchema;
    string: (values?: readonly string[]) => NodeSchema;
    number: () => NodeSchema;
    boolean: () => NodeSchema;
    func: () => NodeSchema;
    union: (anyOf: readonly NodeSchema[], options?: UnionOptions) => NodeSchema;
    any: () => NodeSchema;
}

### validateConfig
function validateConfig(input: unknown, manifest: SchemaManifest, options?: ValidationOptions, rules?: readonly ConfigRule[]): ValidationResult;

### withExtensions
function withExtensions(manifest: SchemaManifest, extensions: readonly Extension[]): SchemaManifest;
