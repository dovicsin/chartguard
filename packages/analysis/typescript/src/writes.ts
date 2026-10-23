import { isContainer, isRecord, keySegment, ownDataProperty } from '@chartguard/core';
import ts from 'typescript';

import type { Decoded } from './decoded.js';
import { unwrapped } from './literals.js';
import { isDirectEval } from './scope.js';
import { traceWithout } from './trace.js';

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
	/** The value at `path` is replaced (an assignment), not changed inside. */
	readonly replaces: boolean;
}

/**
 * A write site: `replaces` when the value at the chain is replaced (assignment, update, `delete`);
 * otherwise the object at the chain stays and its contents change (a method's receiver, an argument).
 * Through an alias, only a change below the aliased object reaches the object it shares.
 */
export interface WriteSite {
	readonly chain: Chain;
	readonly node: ts.Node;
	readonly replaces: boolean;
}

/** Where a chain starts: a name, or the access nodes from it outward. */
export interface Chain {
	readonly root: ts.Identifier;
	/** Each access with its static step; a computed step ends the chain, so nothing after it is listed. */
	readonly accesses: readonly { readonly node: ts.AccessExpression; readonly step: Step }[];
	/** A computed step was cut away: the chain names its root's contents, at any key (`ns[name]`). */
	readonly cut?: boolean;
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
export function chainOf(expression: ts.Expression): Chain | undefined {
	const accesses: { node: ts.AccessExpression; step: Step }[] = [];
	let cut = false;
	let node = unwrapped(expression);
	while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
		const step = stepOf(node);
		// A computed step: what is below it is unknown, so the chain is cut above it.
		if (step === undefined) {
			accesses.length = 0;
			cut = true;
		} else accesses.unshift({ node, step });
		node = unwrapped(node.expression);
	}
	return ts.isIdentifier(node) ? { root: node, accesses, cut } : undefined;
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

export type Call = ts.CallExpression | ts.NewExpression;

/** The chains an argument hands over: itself, or what the literals it builds hold (spreads share nested objects). */
export function passedChains(argument: ts.Expression): Chain[] {
	const node = unwrapped(argument);
	const chain = chainOf(node);
	if (chain !== undefined) return [chain];
	if (ts.isArrayLiteralExpression(node))
		return node.elements.flatMap((element) => passedChains(ts.isSpreadElement(element) ? element.expression : element));
	if (!ts.isObjectLiteralExpression(node)) return [];
	return node.properties.flatMap((property) => {
		if (ts.isPropertyAssignment(property)) return passedChains(property.initializer);
		if (ts.isShorthandPropertyAssignment(property)) return passedChains(property.name);
		return ts.isSpreadAssignment(property) ? passedChains(property.expression) : [];
	});
}

/** Globals that read what they are given and never change it. */
const PURE_MEMBERS: ReadonlyMap<string, ReadonlySet<string> | 'any'> = new Map<string, ReadonlySet<string> | 'any'>([
	['console', 'any'],
	['JSON', new Set(['stringify'])],
	['Object', new Set(['keys', 'values', 'entries', 'getOwnPropertyNames', 'hasOwn', 'isFrozen', 'freeze'])],
	['Array', new Set(['isArray', 'from'])]
]);
const PURE_FUNCTIONS: ReadonlySet<string> = new Set(['structuredClone', 'String', 'Number', 'Boolean']);

/**
 * A call to one of those globals: the name must resolve to the default lib, or to nothing (a
 * Program without lib); a local `console` may do anything.
 */
export function isPureCall(call: Call, program: ts.Program): boolean {
	const callee = call.expression;
	const isGlobal = (name: ts.Identifier): boolean =>
		(program.getTypeChecker().getSymbolAtLocation(name)?.declarations ?? []).every((declaration) =>
			program.isSourceFileDefaultLibrary(declaration.getSourceFile())
		);
	if (ts.isIdentifier(callee)) return PURE_FUNCTIONS.has(callee.text) && isGlobal(callee);
	if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
	const members = PURE_MEMBERS.get(callee.expression.text);
	const pure = members === 'any' || members?.has(callee.name.text) === true;
	return pure && isGlobal(callee.expression);
}

/** The names a binding declares: an identifier, or every identifier of a destructuring pattern. */
function boundNames(name: ts.BindingName): ts.Identifier[] {
	if (ts.isIdentifier(name)) return [name];
	return name.elements.flatMap((element) => (ts.isBindingElement(element) ? boundNames(element.name) : []));
}

/** The names visible at the top level of a file: its own declarations and what it imports. */
function topLevelNames(file: ts.SourceFile): ts.Identifier[] {
	return file.statements.flatMap((statement) => {
		if (ts.isVariableStatement(statement))
			return statement.declarationList.declarations.flatMap((declaration) => boundNames(declaration.name));
		if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined)
			return [statement.name];
		if (ts.isImportEqualsDeclaration(statement)) return [statement.name];
		return ts.isImportDeclaration(statement) ? importedNames(statement) : [];
	});
}

/** The local names an import declaration binds. */
function importedNames({ importClause }: ts.ImportDeclaration): ts.Identifier[] {
	if (importClause === undefined || importClause.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
	const bindings = importClause.namedBindings;
	const own = importClause.name === undefined ? [] : [importClause.name];
	if (bindings === undefined) return own;
	if (ts.isNamespaceImport(bindings)) return [...own, bindings.name];
	return [...own, ...bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name)];
}

/**
 * What code that cannot be read may do to a name: change its contents, and replace it when the
 * binding allows it (a `let`, a `var`, a function; never a `const` or an import).
 */
const everythingAbout = (root: ts.Identifier, node: ts.Node, reassignable: boolean): WriteSite[] => [
	...(reassignable ? [{ chain: { root, accesses: [] }, node, replaces: true }] : []),
	{ chain: { root, accesses: [] }, node, replaces: false }
];

/** Whether a top-level name's binding can be assigned to: not a `const`, `using`, class or import. */
function isReassignable(name: ts.Identifier): boolean {
	const declaration = name.parent;
	if (ts.isFunctionDeclaration(declaration)) return true;
	let node: ts.Node = declaration;
	while (ts.isBindingElement(node) || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))
		node = node.parent;
	return ts.isVariableDeclaration(node) && (node.parent.flags & (ts.NodeFlags.Const | ts.NodeFlags.Using)) === 0;
}

/**
 * Whether a `with` body may set a property of its object by a bare name: it assigns, updates or
 * deletes through a bare name, calls a method on one, declares a function (which runs later, in the
 * object's scope), or evaluates code.
 */
function writesThroughNames(body: ts.Statement): boolean {
	const bare = (written: ts.Expression | undefined): boolean => {
		const chain = written === undefined ? undefined : chainOf(written);
		return chain !== undefined;
	};
	const visit = (node: ts.Node): boolean =>
		ts.isFunctionLike(node) ||
		isDirectEval(node) ||
		bare(writtenByOperator(node)) ||
		bare(writtenByCall(node)) ||
		(ts.forEachChild(node, visit) ?? false);
	return visit(body);
}

/**
 * Writes code may make that its syntax does not spell (A34): a direct `eval` may assign anything it
 * can see, every name at the top level of its file included; a `with` body may set any property of
 * its object by a bare name.
 */
function dynamicSites(node: ts.Node, file: ts.SourceFile): WriteSite[] {
	if (isDirectEval(node))
		return topLevelNames(file).flatMap((root) => everythingAbout(root, node, isReassignable(root)));
	if (!ts.isWithStatement(node) || !writesThroughNames(node.statement)) return [];
	const chain = chainOf(node.expression);
	return chain === undefined ? [] : [{ chain, node, replaces: false }];
}

/**
 * Every write site in `file` with the chain it writes (CG-03-05): assignments, updates, `delete`,
 * method calls on a chain (the receiver), `Object.assign`-like calls (the first argument), and what a
 * direct `eval` or a `with` body may write. Only syntax is read here; which constant a chain starts
 * at is the caller's to resolve.
 */
export function writeSites(file: ts.SourceFile, exempt: (call: Call) => boolean): WriteSite[] {
	const sites: WriteSite[] = [];
	const add = (written: ts.Expression | undefined, node: ts.Node, replaces: boolean): void => {
		const chain = written === undefined ? undefined : chainOf(written);
		if (chain !== undefined) sites.push({ chain, node, replaces });
	};
	const visit = (node: ts.Node): void => {
		add(writtenByOperator(node), node, true);
		add(writtenByCall(node), node, false);
		sites.push(...dynamicSites(node, file));
		// A callee that is not a chart use may change what it is given (CG-03-06).
		if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && !exempt(node))
			for (const chain of (node.arguments ?? []).flatMap(passedChains)) sites.push({ chain, node, replaces: false });
		ts.forEachChild(node, visit);
	};
	visit(file);
	return sites;
}

/**
 * What a file whose syntax cannot be trusted may write (A36): every name it imports, replaced or
 * changed inside. Nothing it does is read, so all of it is unknown.
 */
export function unreadableSites(file: ts.SourceFile): WriteSite[] {
	return file.statements
		.filter(ts.isImportDeclaration)
		.flatMap(importedNames)
		.flatMap((root) => everythingAbout(root, root, false));
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

/** The value at `path`, when every step is an own data property; `missing` when one is not. */
function valueAt(value: unknown, path: readonly Step[]): { readonly value: unknown } | 'missing' {
	let current = value;
	for (const { key } of path) {
		if (!isContainer(current)) return 'missing';
		const entry = ownDataProperty(current, key);
		if (!entry.found) return 'missing';
		current = entry.value;
	}
	return { value: current };
}

/** A change inside a primitive changes nothing: a string, number or boolean has no contents to write. */
function changesNothing(value: unknown, { path, replaces }: Write): boolean {
	if (replaces) return false;
	const found = valueAt(value, path);
	return found !== 'missing' && found.value !== undefined && !isContainer(found.value);
}

/** A decoded constant with every written path left out, unknown from the write site; any write makes it incomplete (CG-03-05). */
export function withoutWritten(decoded: Decoded, all: readonly Write[]): Decoded {
	const writes = all.filter((write) => !changesNothing(decoded.value, write));
	if (writes.length === 0) return decoded;
	let { value, trace } = decoded;
	for (const { path, node } of writes) {
		value = without(value, path);
		trace = traceWithout(
			trace,
			path.map(({ key }) => key),
			node
		);
	}
	return { value, complete: false, ...(trace === undefined ? {} : { trace }) };
}

/** `.options.color`, `.datasets[0]`: a write's path in the notation of validation paths. */
export function pathText(path: readonly Step[]): string {
	return path.map(({ key, index }) => (index ? `[${key}]` : keySegment(key))).join('');
}
