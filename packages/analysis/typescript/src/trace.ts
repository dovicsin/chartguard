import { isContainer, keySegment, ownDataProperty } from '@chartguard/core';
import ts from 'typescript';

/** Why a value, or a part of one, is not known (CG-03-04). */
export type UnknownReason =
	'call' | 'name' | 'expression' | 'computed-key' | 'spread' | 'choice' | 'mutated' | 'cycle' | 'limit';

/**
 * Where each part of a decoded value comes from, path by path: the expression that wrote it, or
 * why it is unknown. Mirrors the value: `entries` by object key or array index.
 */
export interface Trace {
	readonly node: ts.Node;
	readonly unknown?: UnknownReason;
	readonly entries?: ReadonlyMap<string, Trace>;
	/** Keys beyond `entries` may exist or be missing: an unresolved spread, a computed key, a write. */
	readonly open?: { readonly node: ts.Node; readonly reason: UnknownReason };
}

/** The reason an expression the reader does not follow is unknown. */
export function reasonOf(node: ts.Node): UnknownReason {
	if (ts.isCallExpression(node) || ts.isNewExpression(node)) return 'call';
	if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return 'name';
	return 'expression';
}

/** A source range: 1-based lines and columns; the end is exclusive. */
export interface SourceRange {
	readonly file: string;
	readonly line: number;
	readonly column: number;
	readonly endLine: number;
	readonly endColumn: number;
}

/** One path of a value read from source: known, from the range that wrote it, or unknown and why. */
export interface PathFact extends SourceRange {
	/** In the notation of validation paths: `$.options.scales.y`, `$.data.datasets[0]`. */
	readonly path: string;
	/** False when the value at this path is not known; `reason` says why. */
	readonly known: boolean;
	readonly reason?: UnknownReason;
}

/** Facts a value is described by at most; a larger value gets a final `limit` fact (CG-03-08). */
export const MAX_FACTS = 10_000;

/** The path facts of a decoded value, `place` giving each node's range. */
export function factsOf(value: unknown, trace: Trace | undefined, place: (node: ts.Node) => SourceRange): PathFact[] {
	const facts: PathFact[] = [];
	const add = (path: string, node: ts.Node, reason?: UnknownReason): void => {
		if (facts.length < MAX_FACTS)
			facts.push({ path, ...place(node), ...(reason === undefined ? { known: true } : { known: false, reason }) });
	};
	const visit = (part: unknown, at: Trace, path: string): void => {
		if (facts.length >= MAX_FACTS) return;
		const container = isContainer(part);
		add(path, at.node, container ? undefined : at.unknown);
		if (at.open !== undefined) add(path, at.open.node, at.open.reason);
		if (!container) return;
		for (const [key, child] of at.entries ?? []) {
			const entry = ownDataProperty(part, key);
			visit(
				entry.found ? entry.value : undefined,
				child,
				`${path}${Array.isArray(part) ? `[${key}]` : keySegment(key)}`
			);
		}
	};
	if (trace !== undefined) visit(value, trace, '$');
	if (facts.length >= MAX_FACTS && trace !== undefined)
		facts.push({ path: '$', ...place(trace.node), known: false, reason: 'limit' });
	return facts;
}

/** The trace after a write: the written path is unknown, from the write site (CG-03-05). */
export function traceWithout(trace: Trace | undefined, keys: readonly string[], node: ts.Node): Trace | undefined {
	if (trace === undefined) return undefined;
	const [key, ...below] = keys;
	if (key === undefined) return { node: trace.node, open: { node, reason: 'mutated' } };
	const entries = new Map(trace.entries);
	const child = entries.get(key);
	entries.set(
		key,
		below.length === 0 || child === undefined
			? { node, unknown: 'mutated' }
			: (traceWithout(child, below, node) ?? child)
	);
	return { ...trace, entries };
}

/** The range of the most specific known or unknown fact at or above `path` (CG-03-07). */
export function rangeAt(facts: readonly PathFact[], path: string): SourceRange | undefined {
	let best: PathFact | undefined;
	for (const fact of facts) {
		const inside = path === fact.path || path.startsWith(`${fact.path}.`) || path.startsWith(`${fact.path}[`);
		if (inside && (best === undefined || fact.path.length > best.path.length)) best = fact;
	}
	return best === undefined
		? undefined
		: { file: best.file, line: best.line, column: best.column, endLine: best.endLine, endColumn: best.endColumn };
}
