import ts from 'typescript';

export type Binding = 'const' | 'let' | 'var';

function bindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : bindingNames(element.name)));
}

/** The name a declaration statement introduces into its scope, whatever its hoisting rules. */
function declarationName(node: ts.Node): string[] {
	if (ts.isVariableDeclaration(node)) return bindingNames(node.name);
	if (
		ts.isFunctionDeclaration(node) ||
		ts.isClassDeclaration(node) ||
		ts.isEnumDeclaration(node) ||
		ts.isModuleDeclaration(node)
	)
		return node.name !== undefined && ts.isIdentifier(node.name) ? [node.name.text] : [];
	return [];
}

/**
 * Every name declared anywhere inside a function body or block, over-approximating scope:
 * `var` hoists out of nested blocks and `let`/`const` shadow only their block, but treating
 * all of them as shadowing keeps unknown things unknown. Nested functions contribute only
 * their own name; what they declare inside stays theirs.
 */
function namesDeclaredWithin(node: ts.Node): string[] {
	const names: string[] = [];
	const visit = (child: ts.Node): void => {
		names.push(...declarationName(child));
		if (ts.isFunctionLike(child) || ts.isClassLike(child)) return;
		ts.forEachChild(child, visit);
	};
	ts.forEachChild(node, visit);
	return names;
}

function functionNames(node: ts.SignatureDeclaration): string[] {
	const own = ts.isFunctionExpression(node) && node.name !== undefined ? [node.name.text] : [];
	const parameters = node.parameters.flatMap((parameter) => bindingNames(parameter.name));
	return [...own, ...parameters, ...namesDeclaredWithin(node)];
}

function isLoop(node: ts.Node): node is ts.ForStatement | ts.ForInStatement | ts.ForOfStatement {
	return ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node);
}

function isStatementScope(node: ts.Node): node is ts.Block | ts.ModuleBlock | ts.CaseBlock {
	return ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node);
}

/** Names that one scope-introducing node binds, ignoring its ancestors. */
function declaredNames(node: ts.Node): string[] {
	if (ts.isFunctionLike(node)) return functionNames(node);
	if (isStatementScope(node)) return namesDeclaredWithin(node);
	if (isLoop(node)) return node.initializer === undefined ? [] : namesDeclaredWithin(node.initializer);
	if (ts.isCatchClause(node))
		return node.variableDeclaration === undefined ? [] : bindingNames(node.variableDeclaration.name);
	return [];
}

/**
 * Whether `name`, referenced at `site`, is bound by any scope between the site and the
 * source file. Such a reference shadows a top-level binding and must not resolve to it.
 * Every node handed in belongs to a parsed source file, so the walk always ends at it.
 */
export function isLocallyBound(site: ts.Node, name: string): boolean {
	for (let node = site.parent; !ts.isSourceFile(node); node = node.parent)
		if (declaredNames(node).includes(name)) return true;
	return false;
}

/** `const` and `using` bindings cannot be reassigned; their initializer is their value for the whole program. */
export function bindingOf(node: ts.VariableDeclaration): Binding {
	const { flags } = node.parent;
	if ((flags & ts.NodeFlags.Const) !== 0 || (flags & ts.NodeFlags.Using) !== 0) return 'const';
	return (flags & ts.NodeFlags.Let) !== 0 ? 'let' : 'var';
}
