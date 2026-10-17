import type { AdditionalProperties, EnumValue, NodeSchema, SchemaKind, SchemaManifest } from '../schema.js';
import type { IrNode, LiteralNode, ObjectNode, SchemaArtifact } from './types.js';

export interface LoweredSchema {
	readonly manifest: SchemaManifest;
	/** Paths the engine checks only approximately; any entry makes coverage partial. */
	readonly lossy: readonly string[];
}

const ANY: NodeSchema = { kind: 'any' };

type Lowerings = {
	readonly [K in IrNode['kind']]: (node: Extract<IrNode, { readonly kind: K }>, path: string) => NodeSchema;
};
const ENUM_KINDS: ReadonlySet<string> = new Set(['string', 'number', 'boolean']);

function isLiteral(node: IrNode): node is LiteralNode {
	return node.kind === 'literal';
}

function isEnumValue(value: LiteralNode['value']): value is EnumValue {
	return value !== null;
}

/** A union of same-typed literals is an enum; anything else is not expressible yet. */
function enumOf(members: readonly IrNode[]): NodeSchema | undefined {
	const values = members.filter(isLiteral).map((member) => member.value);
	const kinds = new Set(values.map((value) => typeof value));
	const [kind] = kinds;
	if (values.length !== members.length || kinds.size !== 1 || kind === undefined || !ENUM_KINDS.has(kind))
		return undefined;
	return { kind: kind as SchemaKind, enum: values.filter(isEnumValue) };
}

/** Lowers IR to engine schemas. Unsupported constructs become `any` and are recorded as lossy, never guessed. */
class Lowerer {
	readonly lossy: string[] = [];
	private readonly resolving = new Set<string>();
	private readonly lowered = new Map<string, NodeSchema>();

	constructor(private readonly definitions: Readonly<Record<string, IrNode>>) {}

	/** One entry per node kind; the mapped type makes a missing kind a compile error. */
	private readonly lowerings: Lowerings = {
		string: () => ({ kind: 'string' }),
		number: () => ({ kind: 'number' }),
		boolean: () => ({ kind: 'boolean' }),
		function: () => ({ kind: 'function' }),
		null: (_, path) => this.approximate(path),
		unknown: (_, path) => this.approximate(path),
		record: (_, path) => this.approximate(path),
		scriptable: (_, path) => this.approximate(path),
		literal: (node, path) => this.lowerUnion([node], path),
		union: (node, path) => this.lowerUnion(node.anyOf, path),
		array: (node, path) => ({ kind: 'array', element: this.lower(node.items, `${path}[]`) }),
		object: (node, path) => this.lowerObject(node, path),
		ref: (node, path) => this.lowerRef(node.ref, path)
	};

	lower(node: IrNode, path: string): NodeSchema {
		const lowering = this.lowerings[node.kind] as (node: IrNode, path: string) => NodeSchema;
		return lowering(node, path);
	}

	private approximate(path: string): NodeSchema {
		this.lossy.push(path);
		return ANY;
	}

	private lowerUnion(members: readonly IrNode[], path: string): NodeSchema {
		return enumOf(members) ?? this.approximate(path);
	}

	private lowerObject(node: ObjectNode, path: string): NodeSchema {
		const entries = Object.entries(node.properties);
		const properties = Object.fromEntries(
			entries.map(([key, property]) => [key, this.lower(property.node, `${path}.${key}`)])
		);
		const required = entries.filter(([, property]) => property.required === true).map(([key]) => key);
		return { kind: 'object', properties, required, additionalProperties: this.additionalOf(node, path) };
	}

	private additionalOf(node: ObjectNode, path: string): AdditionalProperties {
		if (node.additional === 'open') {
			this.lossy.push(path);
			return 'allow';
		}
		const authoritative = node.provenance?.confidence === 'authoritative';
		return node.additional === 'closed' && authoritative ? 'deny' : 'warn';
	}

	private lowerRef(ref: string, path: string): NodeSchema {
		const cached = this.lowered.get(ref);
		if (cached !== undefined) return cached;
		const target = this.definitions[ref];
		if (target === undefined || this.resolving.has(ref)) return this.approximate(path);
		this.resolving.add(ref);
		try {
			const schema = this.lower(target, path);
			this.lowered.set(ref, schema);
			return schema;
		} finally {
			this.resolving.delete(ref);
		}
	}
}

export function lowerArtifact(artifact: SchemaArtifact): LoweredSchema {
	const lowerer = new Lowerer(artifact.definitions);
	const root = lowerer.lower(artifact.root, '$');
	const exact = artifact.coverage === 'full' && lowerer.lossy.length === 0;
	const source = Object.values(artifact.sources)
		.map(({ locator }) => locator)
		.join(', ');
	return {
		manifest: {
			library: artifact.library,
			version: artifact.libraryVersion,
			coverage: exact ? 'full' : 'partial',
			root,
			source
		},
		lossy: lowerer.lossy
	};
}
