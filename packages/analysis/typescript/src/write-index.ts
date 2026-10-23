import ts from 'typescript';

import { unwrapped } from './literals.js';
import {
	type Call,
	type Chain,
	chainOf,
	passedChains,
	type Step,
	unreadableSites,
	type Write,
	type WriteSite,
	writeSites
} from './writes.js';

/** The declaration a chain starts at, and the path within it. */
export interface ChainTarget {
	readonly declaration: ts.Node;
	readonly path: readonly Step[];
	/**
	 * The chain is a destructured or loop binding with no access after it: replacing it rebinds the
	 * local name and writes nothing it was read from.
	 */
	readonly rebinds?: boolean;
	/** The write lands below `path`, at a key not known (after a rest element or a computed name): it changes the place, never replaces it. */
	readonly inside?: boolean;
}

/** How many aliases deep a write is followed (`const a = b.c; const d = a.e; d.f = 1`). */
const MAX_ALIAS_DEPTH = 8;

/** Where a literal's value at one step may come from: an explicit value, or a spread that copies its own. */
interface Source {
	readonly kind: 'value' | 'spread';
	readonly expression: ts.Expression;
}

function keyOf(property: ts.ObjectLiteralElementLike): string | undefined {
	const { name } = property;
	return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
}

/** In order: an explicit property replaces what came before it; a later spread may override it. */
function objectSources(node: ts.ObjectLiteralExpression, key: string): Source[] {
	let sources: Source[] = [];
	for (const property of node.properties) {
		if (ts.isSpreadAssignment(property)) sources.push({ kind: 'spread', expression: property.expression });
		else if (ts.isPropertyAssignment(property) && keyOf(property) === key)
			sources = [{ kind: 'value', expression: property.initializer }];
		else if (ts.isShorthandPropertyAssignment(property) && property.name.text === key)
			sources = [{ kind: 'value', expression: property.name }];
		// A method or accessor named `key` holds no shared object.
		else if (keyOf(property) === key) sources = [];
	}
	return sources;
}

/** An index names its element, unless a spread before it shifts the elements: then any from there on. */
function arraySources(node: ts.ArrayLiteralExpression, step: Step): Source[] {
	if (!step.index) return [];
	const index = Number(step.key);
	const firstSpread = node.elements.findIndex(ts.isSpreadElement);
	if (firstSpread < 0 || firstSpread > index) {
		const element = node.elements[index];
		return element === undefined ? [] : [{ kind: 'value', expression: element }];
	}
	return node.elements
		.slice(firstSpread)
		.map((element) =>
			ts.isSpreadElement(element)
				? { kind: 'spread', expression: element.expression }
				: { kind: 'value', expression: element }
		);
}

type Shared = { chain: Chain; rest: Step[] }[];

/** What a call's result may share with constants; `fresh` when a builder returns a new literal. */
export interface CallResult {
	readonly fresh: boolean;
	readonly shares: readonly Chain[];
}

/** How a write reaches an initializer: whether it replaces the place, and what a call's result may share. */
interface Reach {
	readonly replaces: boolean;
	readonly sharesOfCall: (call: ts.CallExpression) => CallResult;
}

/** What a spread source shares: an object spread copies `step` itself; an array spread some element, so its contents. */
function sharedBySpread(literal: ts.Expression, source: Source, path: readonly Step[], reach: Reach): Shared {
	if (!ts.isArrayLiteralExpression(literal)) return sharedBelow(source.expression, path, { ...reach, replaces: false });
	const chain = chainOf(unwrapped(source.expression));
	return chain === undefined ? [] : [{ chain, rest: [] }];
}

/** Either side of a choice may be the value: `a ? b : c`, `a ?? b`, `a || b`, `a && b`. */
function alternatives(node: ts.Expression): ts.Expression[] | undefined {
	if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
	if (!ts.isBinaryExpression(node)) return undefined;
	const kind = node.operatorToken.kind;
	const choice =
		kind === ts.SyntaxKind.QuestionQuestionToken ||
		kind === ts.SyntaxKind.BarBarToken ||
		kind === ts.SyntaxKind.AmpersandAmpersandToken;
	return choice ? [node.left, node.right] : undefined;
}

/** A write inside a call's result may change whatever the result shares: their contents become unknown. */
function sharedByCall(call: ts.CallExpression, path: readonly Step[], reach: Reach): Shared {
	const { fresh, shares } = reach.sharesOfCall(call);
	// Replacing the result itself, or a property of a new literal it returns, changes nothing shared.
	if (reach.replaces && (path.length === 0 || (path.length === 1 && fresh))) return [];
	return shares.map((chain) => ({ chain, rest: [] }));
}

/** An initializer that is another constant's chain shares it, below the aliased place unless the write replaces it. */
function sharedByChain(node: ts.Expression, path: readonly Step[], reach: Reach): Shared {
	const chain = chainOf(node);
	return chain !== undefined && (path.length > 0 || !reach.replaces) ? [{ chain, rest: [...path] }] : [];
}

/**
 * The chains of other constants that an initializer shares at `path`, with the rest of the path
 * below them. A spread copies one level: replacing the copy's own property shares nothing.
 */
function sharedBelow(initializer: ts.Expression, path: readonly Step[], reach: Reach): Shared {
	const node = unwrapped(initializer);
	const choices = alternatives(node);
	if (choices !== undefined) return choices.flatMap((choice) => sharedBelow(choice, path, reach));
	if (ts.isCallExpression(node)) return sharedByCall(node, path, reach);
	if (!ts.isObjectLiteralExpression(node) && !ts.isArrayLiteralExpression(node))
		return sharedByChain(node, path, reach);
	return sharedInLiteral(node, path, reach);
}

/** What a written path of an object or array literal shares: the value it holds there, or what a spread copied. */
function sharedInLiteral(
	node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
	path: readonly Step[],
	reach: Reach
): Shared {
	const [step, ...below] = path;
	// The contents of a literal change (it is handed to a call, a method runs on it): so may everything it embeds (A39).
	if (step === undefined)
		return reach.replaces ? sharedByChain(node, path, reach) : passedChains(node).map((chain) => ({ chain, rest: [] }));
	const sources = ts.isObjectLiteralExpression(node) ? objectSources(node, step.key) : arraySources(node, step);
	const reachesCopy = below.length > 0 || !reach.replaces;
	return sources.flatMap((source) => {
		if (source.kind === 'value') return sharedBelow(source.expression, below, reach);
		return reachesCopy ? sharedBySpread(node, source, path, reach) : [];
	});
}

/**
 * What a write at `path` of a variable shares with other constants: its initializer's, or for a
 * `for…of` binding, which holds one element of the iterable at a time, any element's. Rebinding the
 * loop variable itself changes no element.
 */
function sharedThrough(declaration: ts.VariableDeclaration, path: readonly Step[], reach: Reach): Shared {
	const loop = forOfStatement(declaration);
	if (loop === undefined)
		return declaration.initializer === undefined ? [] : sharedBelow(declaration.initializer, path, reach);
	return path.length === 0 && reach.replaces ? [] : sharedBelow(loop.expression, [], { ...reach, replaces: false });
}

/**
 * Every write of readable code, by the declaration it changes (CG-03-05), including writes through
 * an alias or an embedding (`const opts = config.options; opts.color = …` writes `config.options.color`).
 * Built once, on first use.
 */
/** The project files the index reads: those it can trust, and those whose syntax it cannot (A36). */
export interface IndexedSources {
	readonly readable: () => readonly ts.SourceFile[];
	readonly unreadable: () => readonly ts.SourceFile[];
}

/** A `for (… of iterable)` binding's statement: each element of the iterable is bound to it in turn. */
function forOfStatement(declaration: ts.VariableDeclaration): ts.ForOfStatement | undefined {
	const statement = declaration.parent.parent;
	return ts.isForOfStatement(statement) ? statement : undefined;
}

/**
 * Every write of readable code, by the declaration it changes (CG-03-05), including writes through
 * an alias, a destructured or loop binding, or an embedding (`const opts = config.options;
 * opts.color = …` writes `config.options.color`), and what unreadable code may write. Built once, on first use.
 */
export class WriteIndex {
	private writes: Map<ts.Node, Write[]> | undefined;

	constructor(
		private readonly sources: IndexedSources,
		private readonly resolve: (chain: Chain) => readonly ChainTarget[],
		/** Calls that do not change their arguments: chart uses and pure globals. */
		private readonly exempt: (call: Call) => boolean,
		private readonly sharesOfCall: (call: ts.CallExpression) => CallResult
	) {}

	writesTo(declaration: ts.Node): readonly Write[] {
		this.writes ??= this.build();
		return this.writes.get(declaration) ?? [];
	}

	private build(): Map<ts.Node, Write[]> {
		const writes = new Map<ts.Node, Write[]>();
		const sites = [
			...this.sources.readable().flatMap((file) => writeSites(file, this.exempt)),
			...this.sources.unreadable().flatMap(unreadableSites)
		];
		for (const site of sites)
			for (const target of this.resolve(site.chain)) {
				if (target.rebinds === true && site.replaces) continue;
				// Below a computed step the write changes the place it was cut at; it does not replace it.
				const replaces = site.replaces && site.chain.cut !== true && target.inside !== true;
				this.record(writes, target, { ...site, replaces }, 0);
			}
		return writes;
	}

	private record(
		writes: Map<ts.Node, Write[]>,
		{ declaration, path }: ChainTarget,
		site: WriteSite,
		depth: number
	): void {
		const list = writes.get(declaration) ?? [];
		list.push({ path, node: site.node, replaces: site.replaces });
		writes.set(declaration, list);
		if (depth >= MAX_ALIAS_DEPTH || !ts.isVariableDeclaration(declaration)) return;
		const shared = sharedThrough(declaration, path, { replaces: site.replaces, sharesOfCall: this.sharesOfCall });
		for (const { chain, rest } of shared)
			for (const target of this.resolve(chain))
				this.record(writes, { declaration: target.declaration, path: [...target.path, ...rest] }, site, depth + 1);
	}
}
