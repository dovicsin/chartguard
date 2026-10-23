import ts from 'typescript';

import { unwrapped } from './literals.js';

export type Binding = 'const' | 'let' | 'var';

/** `const` and `using` bindings cannot be reassigned; their initializer is their value for the whole program. */
export function bindingOf(node: ts.VariableDeclaration): Binding {
	const { flags } = node.parent;
	if ((flags & ts.NodeFlags.Const) !== 0 || (flags & ts.NodeFlags.Using) !== 0) return 'const';
	return (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
}

/** Scopes a direct `eval` can add `var` bindings to: functions and class static blocks. */
function isVarScope(node: ts.Node): boolean {
	return ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node);
}

/** `eval(…)` and `(eval)(…)` are direct; `(0, eval)(…)` is not and runs in the global scope. */
export function isDirectEval(node: ts.Node): boolean {
	if (!ts.isCallExpression(node)) return false;
	// `(eval)(…)` and `(eval as any)(…)` are emitted as `eval(…)`; `(0, eval)(…)` is a comma expression.
	const callee = unwrapped(node.expression);
	return ts.isIdentifier(callee) && callee.text === 'eval';
}

const evalScopes = new WeakMap<ts.Node, boolean>();

/** Whether this scope's own body calls `eval` directly; what nested functions do stays theirs. */
function callsEval(scope: ts.Node): boolean {
	const known = evalScopes.get(scope);
	if (known !== undefined) return known;
	const visit = (node: ts.Node): boolean =>
		isDirectEval(node) || (!isVarScope(node) && (ts.forEachChild(node, visit) ?? false));
	const found = ts.forEachChild(scope, visit) ?? false;
	evalScopes.set(scope, found);
	return found;
}

/**
 * Whether the scope a name is looked up in is decided only at run time, which the checker does not
 * model: inside the body of a `with` statement the object may supply any name, and a direct `eval`
 * in an enclosing function may declare any name there.
 */
export function isDynamicScope(site: ts.Node): boolean {
	for (let child = site, node = site.parent; !ts.isSourceFile(node); child = node, node = node.parent) {
		if (ts.isWithStatement(node) && node.statement === child) return true;
		if (isVarScope(node) && callsEval(node)) return true;
	}
	return false;
}
