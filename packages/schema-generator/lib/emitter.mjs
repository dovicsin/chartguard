import { createHash } from 'node:crypto';

import ts from 'typescript';

import { deprecationOf } from './deprecation.mjs';
import { Provenance } from './provenance.mjs';

const MAX_DEFINITIONS = 50_000;
/** Longer printed types are abbreviated with a content hash so distinct types never share a name. */
const NAME_LENGTH = 120;
const NAME_PREFIX = 80;
const NAME_FLAGS = ts.TypeFormatFlags.NoTruncation;
/** Platform objects (CanvasGradient, HTMLElement, …) are checked only as "some object". */
const HOST_OBJECT = { kind: 'object', additional: 'open', properties: {} };
/**
 * TypeScript's global function interfaces declare no call signature, so they would pass for
 * platform objects; a value of these types is a function (`(Function | Options)` in Highcharts).
 */
const GLOBAL_FUNCTIONS = new Set(['Function', 'CallableFunction', 'NewableFunction']);
/** A union whose emitted node is larger than this is stored once as a definition and referenced. */
const SHARED_UNION_BYTES = 300;

function isFlag(type, flag) {
	return (type.flags & flag) !== 0;
}

function withoutUndefined(types) {
	return types.filter((type) => !isFlag(type, ts.TypeFlags.Undefined | ts.TypeFlags.Void));
}

const PRIMITIVE_FLAGS = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike;

function isPrimitiveLike(type) {
	return isFlag(type, PRIMITIVE_FLAGS);
}

/** Symbol-keyed members (`[Symbol.iterator]`) cannot occur in a configuration object. */
function isStringKeyed(symbol) {
	return !symbol.escapedName.startsWith('__@');
}

/**
 * A readable, collision-free definition name. The full printed type is kept when short;
 * otherwise a prefix plus a hash of the whole text, so unrelated types never collapse into one name.
 */
function definitionName(printed) {
	const name = printed.replace(/\s+/g, ' ').trim();
	if (name.length <= NAME_LENGTH) return name;
	const digest = createHash('sha256').update(name).digest('hex').slice(0, 10);
	return `${name.slice(0, NAME_PREFIX)}…#${digest}`;
}

/**
 * Converts TypeScript types into SchemaIR nodes. Object types become shared
 * definitions so recursive and repeated types stay finite.
 */
export class TypeEmitter {
	constructor({
		program,
		checker,
		sourceId,
		packageName,
		opaque = new Set(),
		open = new Set(),
		registries = new Map(),
		runtimeOptional = new Set(),
		widened = new Map(),
		wrappers = new Set()
	}) {
		this.program = program;
		this.checker = checker;
		this.provenance = new Provenance(checker, { sourceId, packageName });
		/** Types whose contents the declarations do not describe (caller-chosen data). */
		this.opaque = opaque;
		/** Object types that are documented extension points. */
		this.open = open;
		/**
		 * Union type → `{ registry, provenance }`: the runtime registry its variants are looked up in,
		 * which plugins extend, so the union is extensible and checked against the caller's registry.
		 */
		this.registries = registries;
		/** Property symbols the declarations require but the runtime defaults. */
		this.runtimeOptional = runtimeOptional;
		/**
		 * Property declaration node → extra IR nodes the runtime also accepts there. Keyed by the
		 * declaration, because a property reached through an intersection is a transient symbol.
		 */
		this.widened = widened;
		/** Alias names of homomorphic mapped wrappers (`DeepPartial`) that pass primitives through unchanged. */
		this.wrappers = wrappers;
		/** Type → builder of a replacement node, for positions the declarations do not describe faithfully. */
		this.overrides = new Map();
		this.definitions = {};
		this.names = new Map();
		this.usedNames = new Set();
		this.sharedUnions = new Map();
	}

	emit(type) {
		const override = this.overrides.get(type);
		if (override !== undefined) return override();
		if (this.opaque.has(type)) return { kind: 'unknown' };
		const primitive = this.emitPrimitive(type);
		if (primitive !== undefined) return primitive;
		if (type.isUnion()) return this.emitUnion(type);
		if (isFlag(type, ts.TypeFlags.Object | ts.TypeFlags.Intersection)) return this.emitObjectLike(type);
		return { kind: 'unknown' };
	}

	emitPrimitive(type) {
		if (isFlag(type, ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return { kind: 'unknown' };
		if (isFlag(type, ts.TypeFlags.StringLike & ~ts.TypeFlags.StringLiteral)) return { kind: 'string' };
		if (isFlag(type, ts.TypeFlags.NumberLike & ~ts.TypeFlags.NumberLiteral)) return { kind: 'number' };
		if (type.isStringLiteral() || type.isNumberLiteral()) return { kind: 'literal', value: type.value };
		if (isFlag(type, ts.TypeFlags.BooleanLiteral))
			return { kind: 'literal', value: type === this.checker.getTrueType() };
		if (isFlag(type, ts.TypeFlags.Null)) return { kind: 'null' };
		return undefined;
	}

	/**
	 * Distinct TypeScript types can emit the same node (`string[]` twice via different wrappers); keep one.
	 * A large union the package names (`AnimationEasing`) is emitted once as a definition and referenced.
	 */
	emitUnion(type) {
		const node = this.buildUnion(type);
		return node.kind === 'union' ? this.share(node, type) : node;
	}

	/**
	 * Large unions recur under many properties (an easing name list, a color union). Keyed by
	 * their emitted content, so the same union reached through `T` or an optional `T | undefined`
	 * is stored once; the first type that produced it names the definition.
	 */
	share(node, type) {
		const content = JSON.stringify(node);
		if (content.length <= SHARED_UNION_BYTES) return node;
		const existing = this.sharedUnions.get(content);
		if (existing !== undefined) return { kind: 'ref', ref: existing };
		const printed = this.checker.typeToString(type, undefined, NAME_FLAGS).replace(/ \| undefined$/, '');
		const name = this.uniqueName(definitionName(printed));
		this.sharedUnions.set(content, name);
		this.definitions[name] = node;
		return { kind: 'ref', ref: name };
	}

	buildUnion(type) {
		const members = withoutUndefined(type.types);
		const booleans = members.filter((member) => isFlag(member, ts.TypeFlags.BooleanLiteral));
		const rest = members.filter((member) => !isFlag(member, ts.TypeFlags.BooleanLiteral));
		const nodes = [...(booleans.length === 2 ? [{ kind: 'boolean' }] : booleans.map((b) => this.emit(b)))];
		nodes.push(...rest.map((member) => this.emit(member)));
		const unique = [...new Map(nodes.map((node) => [JSON.stringify(node), node])).values()];
		if (unique.length === 1) return unique[0];
		return this.withDiscriminator({ kind: 'union', anyOf: unique }, rest, this.registryOf(type));
	}

	/** Callers may name either `T` or the `T | undefined` of an optional property. */
	registryOf(type) {
		return this.registries.get(type) ?? this.registries.get(this.checker.getNonNullableType(type));
	}

	withDiscriminator(union, members, registered) {
		const discriminator = this.discriminatorOf(members);
		if (discriminator === undefined) return union;
		if (registered === undefined) return { ...union, discriminator };
		return {
			...union,
			discriminator,
			extensible: true,
			registry: registered.registry,
			...(registered.extensionPoint === undefined ? {} : { extensionPoint: registered.extensionPoint }),
			provenance: registered.provenance
		};
	}

	/**
	 * A property present in every object member whose literal values are disjoint. Array members
	 * are left out: the engine tells arrays from objects by runtime kind, so `T | T[]` (which
	 * TypeScript flattens into one union) still discriminates its object members.
	 */
	discriminatorOf(members) {
		const objects = members.filter((member) => !this.checker.isArrayType(member) && !this.checker.isTupleType(member));
		if (
			objects.length < 2 ||
			!objects.every((member) => isFlag(member, ts.TypeFlags.Object | ts.TypeFlags.Intersection))
		)
			return undefined;
		const [first] = objects;
		const candidates = this.checker.getPropertiesOfType(first).map((symbol) => symbol.name);
		return candidates.find((name) => this.isDiscriminator(objects, name));
	}

	isDiscriminator(members, name) {
		const seen = new Set();
		for (const member of members) {
			const symbol = this.checker.getPropertyOfType(member, name);
			if (symbol === undefined) return false;
			const type = this.checker.getTypeOfSymbol(symbol);
			const literals = withoutUndefined(type.isUnion() ? type.types : [type]);
			if (literals.length === 0 || !literals.every((literal) => literal.isStringLiteral())) return false;
			for (const literal of literals) {
				if (seen.has(literal.value)) return false;
				seen.add(literal.value);
			}
		}
		return true;
	}

	/** DOM and other platform objects are opaque, also when wrapped in a generic such as `DeepPartial<T>`. */
	isHostType(type) {
		const declarations = type.getSymbol()?.declarations ?? [];
		if (declarations.some((declaration) => this.program.isSourceFileDefaultLibrary(declaration.getSourceFile())))
			return true;
		const [wrapped, ...rest] = type.aliasTypeArguments ?? [];
		return wrapped !== undefined && rest.length === 0 && this.isHostType(wrapped);
	}

	emitObjectLike(type) {
		if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0) return { kind: 'function' };
		if (GLOBAL_FUNCTIONS.has(type.getSymbol()?.escapedName) && this.isLibraryDeclared(type.getSymbol()))
			return { kind: 'function' };
		if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) return this.emitArray(type);
		const unwrapped = this.emitUnwrapped(type);
		if (unwrapped !== undefined) return unwrapped;
		if (this.isHostType(type)) return this.reference(type, () => HOST_OBJECT);
		return this.reference(type);
	}

	isLibraryDeclared(symbol) {
		return (symbol?.declarations ?? []).some((declaration) =>
			this.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
		);
	}

	/**
	 * Homomorphic wrappers such as `DeepPartial<T>` also map over primitives and arrays. A wrapped
	 * array is recognized by its numeric index plus the built-in `length`, and keeps its
	 * (partial) element type; a wrapped primitive is still that primitive. Only the wrappers
	 * named in `wrappers` qualify: `Wrap<T> = { v: T }` is an object, whatever `T` is.
	 */
	emitUnwrapped(type) {
		const array = this.emitWrappedArray(type);
		if (array !== undefined) return array;
		if (!this.wrappers.has(type.aliasSymbol?.name)) return undefined;
		const [wrapped, ...rest] = type.aliasTypeArguments ?? [];
		if (wrapped === undefined || rest.length > 0) return undefined;
		const members = wrapped.isIntersection() ? wrapped.types : [wrapped];
		const primitive = members.find(isPrimitiveLike);
		return primitive === undefined ? undefined : this.emit(primitive);
	}

	emitWrappedArray(type) {
		const element = this.checker.getIndexInfoOfType(type, ts.IndexKind.Number)?.type;
		if (element === undefined || !this.isLibraryDeclared(this.checker.getPropertyOfType(type, 'length')))
			return undefined;
		return { kind: 'array', items: this.emit(element) };
	}

	emitArray(type) {
		const elements = this.checker.getTypeArguments(type);
		if (elements.length === 1) return { kind: 'array', items: this.emit(elements[0]) };
		const items = this.checker.getUnionType(elements);
		return { kind: 'array', items: this.emit(items) };
	}

	/** One shared definition per type, so repeated and recursive types stay finite. */
	reference(type, build = () => this.emitObject(type)) {
		const existing = this.names.get(type);
		if (existing !== undefined) return { kind: 'ref', ref: existing };
		if (this.names.size >= MAX_DEFINITIONS) return { kind: 'unknown' };
		const name = this.uniqueName(definitionName(this.checker.typeToString(type, undefined, NAME_FLAGS)));
		this.names.set(type, name);
		this.definitions[name] = { kind: 'unknown' };
		this.definitions[name] = build();
		return { kind: 'ref', ref: name };
	}

	uniqueName(base) {
		let name = base;
		for (let suffix = 2; this.usedNames.has(name); suffix++) name = `${base}~${String(suffix)}`;
		this.usedNames.add(name);
		return name;
	}

	emitObject(type) {
		const [index] = this.checker.getIndexInfosOfType(type);
		const properties = this.checker.getPropertiesOfType(type).filter(isStringKeyed);
		if (index !== undefined && properties.length === 0) return { kind: 'record', values: this.emit(index.type) };
		const owner = this.provenance.ownerOf(type);
		const entries = properties.map((symbol) => [symbol.name, this.emitProperty(symbol, owner)]);
		return {
			kind: 'object',
			additional: index === undefined && !this.open.has(type) ? 'closed' : 'open',
			provenance: this.provenance.of(owner),
			properties: Object.fromEntries(entries)
		};
	}

	/** Keys synthesized by mapped types have no declaration of their own; they cite their owner type. */
	emitProperty(symbol, owner) {
		const declared = this.emit(this.checker.getTypeOfSymbol(symbol));
		const extra = this.widened.get(symbol.declarations?.[0]);
		const node = extra === undefined ? declared : { kind: 'union', anyOf: [declared, ...extra] };
		const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0 || this.runtimeOptional.has(symbol);
		const provenance = this.provenance.of(symbol.declarations?.[0] === undefined ? owner : symbol);
		const deprecated = deprecationOf(symbol);
		return {
			node,
			provenance,
			...(optional ? {} : { required: true }),
			...(deprecated === undefined ? {} : { deprecated })
		};
	}
}
