import ts from 'typescript';

const MAX_DEFINITIONS = 50_000;
const PACKAGE_PATH = /^.*\/node_modules\//;
const NAME_LENGTH = 60;

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

function sanitize(name) {
	return name.replace(/[^A-Za-z0-9_<>,.[\]|' -]/g, '').slice(0, NAME_LENGTH);
}

/**
 * Converts TypeScript types into SchemaIR nodes. Object types become shared
 * definitions so recursive and repeated types stay finite.
 */
export class TypeEmitter {
	constructor({ program, checker, sourceId, opaque = new Set(), open = new Set() }) {
		this.program = program;
		this.checker = checker;
		this.sourceId = sourceId;
		this.opaque = opaque;
		this.open = open;
		/** Type → builder of a replacement node, for positions the declarations do not describe faithfully. */
		this.overrides = new Map();
		this.definitions = {};
		this.names = new Map();
		this.usedNames = new Set();
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

	emitUnion(type) {
		const members = withoutUndefined(type.types);
		const booleans = members.filter((member) => isFlag(member, ts.TypeFlags.BooleanLiteral));
		const rest = members.filter((member) => !isFlag(member, ts.TypeFlags.BooleanLiteral));
		const nodes = [...(booleans.length === 2 ? [{ kind: 'boolean' }] : booleans.map((b) => this.emit(b)))];
		nodes.push(...rest.map((member) => this.emit(member)));
		if (nodes.length === 1) return nodes[0];
		return this.withDiscriminator({ kind: 'union', anyOf: nodes }, rest);
	}

	withDiscriminator(union, members) {
		const discriminator = this.discriminatorOf(members);
		return discriminator === undefined ? union : { ...union, discriminator };
	}

	/** A property present in every object member whose literal values are disjoint. */
	discriminatorOf(members) {
		if (members.length < 2 || !members.every((member) => isFlag(member, ts.TypeFlags.Object | ts.TypeFlags.Intersection)))
			return undefined;
		const [first] = members;
		const candidates = this.checker.getPropertiesOfType(first).map((symbol) => symbol.name);
		return candidates.find((name) => this.isDiscriminator(members, name));
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
		if (this.checker.isArrayType(type) || this.checker.isTupleType(type)) return this.emitArray(type);
		const unwrapped = this.emitUnwrapped(type);
		if (unwrapped !== undefined) return unwrapped;
		// Platform objects (CanvasGradient, HTMLElement, …) are checked only as "some object".
		if (this.isHostType(type)) return { kind: 'object', additional: 'open', properties: {} };
		return this.reference(type);
	}

	isLibraryDeclared(symbol) {
		return (symbol?.declarations ?? []).some((declaration) =>
			this.program.isSourceFileDefaultLibrary(declaration.getSourceFile())
		);
	}

	/**
	 * Generic wrappers such as `DeepPartial<T>` also map over primitives and arrays. A wrapped
	 * array is recognized by its numeric index plus the built-in `length`, and keeps its
	 * (partial) element type; a wrapped primitive is still that primitive.
	 */
	emitUnwrapped(type) {
		const element = this.checker.getIndexInfoOfType(type, ts.IndexKind.Number)?.type;
		if (element !== undefined && this.isLibraryDeclared(this.checker.getPropertyOfType(type, 'length')))
			return { kind: 'array', items: this.emit(element) };
		const [wrapped, ...rest] = type.aliasTypeArguments ?? [];
		if (wrapped === undefined || rest.length > 0) return undefined;
		const members = wrapped.isIntersection() ? wrapped.types : [wrapped];
		const primitive = members.find(isPrimitiveLike);
		return primitive === undefined ? undefined : this.emit(primitive);
	}

	emitArray(type) {
		const elements = this.checker.getTypeArguments(type);
		if (elements.length === 1) return { kind: 'array', items: this.emit(elements[0]) };
		const items = this.checker.getUnionType(elements);
		return { kind: 'array', items: this.emit(items) };
	}

	reference(type) {
		const existing = this.names.get(type);
		if (existing !== undefined) return { kind: 'ref', ref: existing };
		if (this.names.size >= MAX_DEFINITIONS) return { kind: 'unknown' };
		const name = this.uniqueName(sanitize(this.checker.typeToString(type)));
		this.names.set(type, name);
		this.definitions[name] = { kind: 'unknown' };
		this.definitions[name] = this.emitObject(type);
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
		const owner = this.isPublished(type.aliasSymbol) ? type.aliasSymbol : type.getSymbol();
		const entries = properties.map((symbol) => [symbol.name, this.emitProperty(symbol, owner)]);
		return {
			kind: 'object',
			additional: index === undefined && !this.open.has(type) ? 'closed' : 'open',
			provenance: this.provenanceOf(owner),
			properties: Object.fromEntries(entries)
		};
	}

	/** Keys synthesized by mapped types have no declaration of their own; they cite their owner type. */
	emitProperty(symbol, owner) {
		const node = this.emit(this.checker.getTypeOfSymbol(symbol));
		const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
		const provenance = this.provenanceOf(symbol.declarations?.[0] === undefined ? owner : symbol);
		return { node, provenance, ...(optional ? {} : { required: true }) };
	}

	/** Declared in an installed package rather than in the generator's own entry file. */
	isPublished(symbol) {
		const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
		return file !== undefined && PACKAGE_PATH.test(file);
	}

	/** Pointers are package-relative (`chart.js/dist/types/index.d.ts:12`); local paths never leak. */
	provenanceOf(symbol) {
		const declaration = symbol?.declarations?.[0];
		const file = declaration?.getSourceFile();
		if (file === undefined || !PACKAGE_PATH.test(file.fileName))
			return { confidence: 'authoritative', sources: [{ source: this.sourceId }] };
		const { line } = file.getLineAndCharacterOfPosition(declaration.getStart(file));
		const pointer = `${file.fileName.replace(PACKAGE_PATH, '')}:${String(line + 1)}`;
		return { confidence: 'authoritative', sources: [{ source: this.sourceId, pointer }] };
	}
}
