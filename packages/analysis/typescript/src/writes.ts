import { isContainer, isRecord, keySegment, ownDataProperty } from '@chartguard/core';
import ts from 'typescript';

import type { Decoded } from './decoded.js';

/** One step of a property chain: `.name`, `['name']` or `[0]`. */
export interface Step {
	readonly key: string;
	/** Written as an array index (`[0]`). */
	readonly index: boolean;
}

/** A place where code may change a constant's value: everything at `path` is unknown. */
export interface Write {
	readonly path: readonly Step[];
	readonly node: ts.Node;
}

/** Where a chain starts: a name, or the access nodes from it outward. */
export interface Chain {
	readonly root: ts.Identifier;
	/** Each access with its static step; a computed step ends the chain, so nothing after it is listed. */
	readonly accesses: readonly { readonly node: ts.AccessExpression; readonly step: Step }[];
}

const MUTATORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
	['Object', new Set(['assign', 'defineProperty', 'defineProperties'])],
	['Reflect', new Set(['set', 'defineProperty', 'deleteProperty'])]
]);

function stepOf(node: ts.AccessExpression): Step | undefined {
	if (ts.isPropertyAccessExpression(node)) return { key: node.name.text, index: false };
	const argument = node.argumentExpression;
	if (ts.isStringLiteralLike(argument)) return { key: argument.text, index: false };
	if (ts.isNumericLiteral(argument)) return { key: argument.text, index: true };
	return undefined;
}

/** The chain `expression` reads, from its root name; undefined when it does not start at a name. */
function chainOf(expression: ts.Expression): Chain | undefined {
	const accesses: { node: ts.AccessExpression; step: Step }[] = [];
	let node = expression;
	while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
	while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
		const step = stepOf(node);
		// A computed step: what is below it is unknown, so the chain is cut above it.
		if (step === undefined) accesses.length = 0;
		else accesses.unshift({ node, step });
		node = node.expression;
		while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
	}
	return ts.isIdentifier(node) ? { root: node, accesses } : undefined;
}

const isAssignment = (kind: ts.SyntaxKind): boolean =>
	kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

const isUpdate = (operator: ts.SyntaxKind): boolean =>
	operator === ts.SyntaxKind.PlusPlusToken || operator === ts.SyntaxKind.MinusMinusToken;

/** `Object.assign(target, …)` and the like change their first argument. */
function mutatedArgument(call: ts.CallExpression): ts.Expression | undefined {
	const callee = call.expression;
	if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return undefined;
	return MUTATORS.get(callee.expression.text)?.has(callee.name.text) === true ? call.arguments[0] : undefined;
}

/** What an assignment, `++`/`--` or `delete` changes. */
function writtenByOperator(node: ts.Node): ts.Expression | undefined {
	if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) return node.left;
	if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && isUpdate(node.operator))
		return node.operand;
	return ts.isDeleteExpression(node) ? node.expression : undefined;
}

/** What a method call may change: its receiver, or the target of `Object.assign`-like calls. */
function writtenByCall(node: ts.Node): ts.Expression | undefined {
	if (!ts.isCallExpression(node)) return undefined;
	const callee = node.expression;
	if (!ts.isPropertyAccessExpression(callee) && !ts.isElementAccessExpression(callee)) return undefined;
	return mutatedArgument(node) ?? callee.expression;
}

/**
 * Every write site in `file` with the chain it writes (CG-03-05): assignments, updates, `delete`,
 * method calls on a chain (the receiver) and `Object.assign`-like calls (the first argument).
 * Only syntax is read here; which constant a chain starts at is the caller's to resolve.
 */
export function writeSites(file: ts.SourceFile): { readonly chain: Chain; readonly node: ts.Node }[] {
	const sites: { chain: Chain; node: ts.Node }[] = [];
	const visit = (node: ts.Node): void => {
		const written = writtenByOperator(node) ?? writtenByCall(node);
		const chain = written === undefined ? undefined : chainOf(written);
		if (chain !== undefined) sites.push({ chain, node });
		ts.forEachChild(node, visit);
	};
	visit(file);
	return sites;
}

function emptied(value: unknown): unknown {
	if (Array.isArray(value)) return [];
	return isRecord(value) ? (Object.create(null) as Record<string, unknown>) : undefined;
}

/** `value` without what `path` names: an object key is removed, an array element becomes a hole (A3). */
function without(value: unknown, path: readonly Step[]): unknown {
	if (path.length === 0) return emptied(value);
	let container = value;
	for (const { key } of path.slice(0, -1)) {
		if (!isContainer(container)) return value;
		const entry = ownDataProperty(container, key);
		if (!entry.found) return value;
		container = entry.value;
	}
	const last = path.at(-1);
	// Decoded values are fresh null-prototype records and arrays built for this read alone.
	if (last !== undefined && isContainer(container)) Reflect.deleteProperty(container, last.key);
	return value;
}

/** A decoded constant with every written path left out; any write makes it incomplete (CG-03-05). */
export function withoutWritten(decoded: Decoded, writes: readonly Write[]): Decoded {
	if (writes.length === 0) return decoded;
	return { value: writes.reduce((value, { path }) => without(value, path), decoded.value), complete: false };
}

/** `.options.color`, `.datasets[0]`: a write's path in the notation of validation paths. */
export function pathText(path: readonly Step[]): string {
	return path.map(({ key, index }) => (index ? `[${key}]` : keySegment(key))).join('');
}
