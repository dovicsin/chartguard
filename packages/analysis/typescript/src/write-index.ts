import ts from 'typescript';

import { type Call, type Chain, chainOf, type Step, type Write, type WriteSite, writeSites } from './writes.js';

/** The declaration a chain starts at, and the path within it. */
export interface ChainTarget {
	readonly declaration: ts.Node;
	readonly path: readonly Step[];
}

/** How many aliases deep a write is followed (`const a = b.c; const d = a.e; d.f = 1`). */
const MAX_ALIAS_DEPTH = 8;

function unwrap(node: ts.Expression): ts.Expression {
	let inner = node;
	while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner))
		inner = inner.expression;
	return inner;
}

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

/** What a spread source shares: an object spread copies `step` itself; an array spread some element, so its contents. */
function sharedBySpread(literal: ts.Expression, source: Source, path: readonly Step[]): Shared {
	if (!ts.isArrayLiteralExpression(literal)) return sharedBelow(source.expression, path, false);
	const chain = chainOf(unwrap(source.expression));
	return chain === undefined ? [] : [{ chain, rest: [] }];
}

/**
 * The chains of other constants that an initializer shares at `path`, with the rest of the path
 * below them. A spread copies one level: replacing the copy's own property shares nothing.
 */
function sharedBelow(initializer: ts.Expression, path: readonly Step[], replaces: boolean): Shared {
	const node = unwrap(initializer);
	const [step, ...below] = path;
	if (step === undefined || !(ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node))) {
		const chain = chainOf(node);
		return chain !== undefined && (path.length > 0 || !replaces) ? [{ chain, rest: [...path] }] : [];
	}
	const sources = ts.isObjectLiteralExpression(node) ? objectSources(node, step.key) : arraySources(node, step);
	const reachesCopy = below.length > 0 || !replaces;
	return sources.flatMap((source) => {
		if (source.kind === 'value') return sharedBelow(source.expression, below, replaces);
		return reachesCopy ? sharedBySpread(node, source, path) : [];
	});
}

/**
 * Every write of readable code, by the declaration it changes (CG-03-05), including writes through
 * an alias or an embedding (`const opts = config.options; opts.color = …` writes `config.options.color`).
 * Built once, on first use.
 */
export class WriteIndex {
	private writes: Map<ts.Node, Write[]> | undefined;

	constructor(
		private readonly sources: () => readonly ts.SourceFile[],
		private readonly resolve: (chain: Chain) => ChainTarget | undefined,
		/** Calls that do not change their arguments: chart uses and pure globals. */
		private readonly exempt: (call: Call) => boolean
	) {}

	writesTo(declaration: ts.Node): readonly Write[] {
		this.writes ??= this.build();
		return this.writes.get(declaration) ?? [];
	}

	private build(): Map<ts.Node, Write[]> {
		const writes = new Map<ts.Node, Write[]>();
		for (const file of this.sources())
			for (const site of writeSites(file, this.exempt)) {
				const target = this.resolve(site.chain);
				if (target !== undefined) this.record(writes, target, site, 0);
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
		list.push({ path, node: site.node });
		writes.set(declaration, list);
		if (depth >= MAX_ALIAS_DEPTH || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined)
			return;
		for (const { chain, rest } of sharedBelow(declaration.initializer, path, site.replaces)) {
			const shared = this.resolve(chain);
			if (shared !== undefined)
				this.record(writes, { declaration: shared.declaration, path: [...shared.path, ...rest] }, site, depth + 1);
		}
	}
}
