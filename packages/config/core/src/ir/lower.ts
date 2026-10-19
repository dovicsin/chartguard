import type { AdditionalProperties, EnumValue, NodeSchema, SchemaKind, SchemaManifest } from '../schema.js';
import type { IrNode, LiteralNode, ObjectNode, PropertyNode, SchemaArtifact, UnionNode } from './types.js';

export interface LoweredSchema {
	readonly manifest: SchemaManifest;
	/**
	 * Paths the engine checks only approximately; any entry makes coverage partial.
	 * Documented extension points (`additional: 'open'`) are not lossy: accepting
	 * unknown keys there is the exact behaviour, not an approximation.
	 * A shared definition is lowered once, so a lossy spot inside it is listed under the
	 * path where the definition was first reached, not under every path that reuses it.
	 */
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
	/** Definitions whose node is registered but not filled yet: reached again, they are recursive. */
	private readonly incomplete = new Set<NodeSchema>();
	private readonly lowered = new Map<string, NodeSchema>();

	constructor(private readonly definitions: Readonly<Record<string, IrNode>>) {}

	/** One entry per node kind; the mapped type makes a missing kind a compile error. */
	private readonly lowerings: Lowerings = {
		string: () => ({ kind: 'string' }),
		number: () => ({ kind: 'number' }),
		boolean: () => ({ kind: 'boolean' }),
		function: () => ({ kind: 'function' }),
		null: () => ({ kind: 'null' }),
		unknown: (_, path) => this.approximate(path),
		record: (node, path) => ({
			kind: 'object',
			properties: {},
			values: this.lower(node.values, `${path}[*]`),
			additionalProperties: 'allow'
		}),
		scriptable: (node, path) => ({ kind: 'union', anyOf: [this.lower(node.value, path), { kind: 'function' }] }),
		literal: (node, path) =>
			node.value === null ? { kind: 'null' } : this.lowerUnion({ kind: 'union', anyOf: [node] }, path),
		union: (node, path) => this.lowerUnion(node, path),
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

	private lowerUnion(node: UnionNode, path: string): NodeSchema {
		const enumeration = enumOf(node.anyOf);
		if (enumeration !== undefined) return enumeration;
		return {
			kind: 'union',
			anyOf: node.anyOf.map((member) => this.lower(member, path)),
			...(node.discriminator === undefined ? {} : { discriminator: node.discriminator }),
			...(node.defaultVariant === undefined ? {} : { defaultVariant: node.defaultVariant }),
			...(node.defaultWhen === undefined ? {} : { defaultWhen: node.defaultWhen }),
			...(node.defaultFrom === undefined ? {} : { defaultFrom: node.defaultFrom }),
			...(node.extensible === undefined ? {} : { extensible: node.extensible }),
			...(node.registry === undefined ? {} : { registry: node.registry }),
			...(node.extensionPoint === undefined ? {} : { extensionPoint: node.extensionPoint })
		};
	}

	/** Own properties, then those of included definitions that the object does not declare itself. */
	private propertiesOf(node: ObjectNode): [string, PropertyNode][] {
		const merged = new Map(Object.entries(node.properties));
		for (const name of node.includes ?? []) {
			const target = this.definitions[name];
			if (target?.kind !== 'object') continue;
			for (const [key, property] of Object.entries(target.properties)) if (!merged.has(key)) merged.set(key, property);
		}
		return [...merged];
	}

	private lowerObject(node: ObjectNode, path: string): NodeSchema {
		const entries = this.propertiesOf(node);
		const properties = Object.fromEntries(
			entries.map(([key, property]) => [key, this.withMetadata(this.lower(property.node, `${path}.${key}`), property)])
		);
		const required = entries.filter(([, property]) => property.required === true).map(([key]) => key);
		const nullAsAbsent = node.nullAsAbsent === true ? { nullAsAbsent: true } : {};
		const point = node.extensionPoint === undefined ? {} : { extensionPoint: node.extensionPoint };
		return {
			kind: 'object',
			properties,
			required,
			additionalProperties: this.additionalOf(node),
			...nullAsAbsent,
			...point
		};
	}

	private additionalOf(node: ObjectNode): AdditionalProperties {
		if (node.additional === 'open') return 'allow';
		const authoritative = node.provenance?.confidence === 'authoritative';
		return node.additional === 'closed' && authoritative ? 'deny' : 'warn';
	}

	/**
	 * A definition is lowered once, into a node registered before its contents, so a definition
	 * that refers to itself (a tree's `children`) gets a cyclic schema checked at every depth: the
	 * walk is bounded by the value it walks, never by the schema.
	 */
	private lowerRef(ref: string, path: string): NodeSchema {
		const known = this.lowered.get(ref);
		if (known !== undefined) return known;
		const target = this.definitions[ref];
		if (target === undefined) return this.approximate(path);
		const node: Record<string, unknown> = {};
		const schema = node as unknown as NodeSchema;
		this.lowered.set(ref, schema);
		this.incomplete.add(schema);
		Object.assign(node, this.lower(target, path));
		this.incomplete.delete(schema);
		return schema;
	}

	/**
	 * A property's value with its metadata. Metadata is copied onto the value, except onto a
	 * definition still being lowered (a recursive reference): copying it now would copy an empty
	 * node, so the value is wrapped in a one-member union, which accepts exactly what its member does.
	 */
	private withMetadata(value: NodeSchema, { handledBy, deprecated }: PropertyNode): NodeSchema {
		if (handledBy === undefined && deprecated === undefined) return value;
		const metadata = {
			...(handledBy === undefined ? {} : { handledBy }),
			...(deprecated === undefined ? {} : { deprecated })
		};
		return this.incomplete.has(value) ? { kind: 'union', anyOf: [value], ...metadata } : { ...value, ...metadata };
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
			...(artifact.digest === undefined ? {} : { digest: artifact.digest }),
			coverage: exact ? 'full' : 'partial',
			root,
			source
		},
		lossy: lowerer.lossy
	};
}
