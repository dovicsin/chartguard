import ts from 'typescript';

/**
 * A function whose result can be read without running it (CG-03-05): a body of `const`
 * declarations and one `return`, or an expression body; plain parameters; not async, not a generator.
 */
export interface Builder {
	readonly declaration: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
	readonly parameters: readonly ts.ParameterDeclaration[];
	readonly locals: ReadonlySet<ts.Node>;
	readonly result: ts.Expression;
}

type BuilderFunction = Builder['declaration'];

function isPlainFunction(node: ts.Node): node is BuilderFunction {
	if (!(ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) return false;
	const isAsync = (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;
	const isGenerator = !ts.isArrowFunction(node) && node.asteriskToken !== undefined;
	const plain = node.parameters.every(
		(parameter) => ts.isIdentifier(parameter.name) && parameter.dotDotDotToken === undefined
	);
	return !isAsync && !isGenerator && plain;
}

/** The `const` declarations before the final `return`, or undefined when the body holds anything else. */
function localsOf(statements: readonly ts.Statement[]): Set<ts.Node> | undefined {
	const locals = new Set<ts.Node>();
	for (const statement of statements) {
		if (!ts.isVariableStatement(statement) || (statement.declarationList.flags & ts.NodeFlags.Const) === 0)
			return undefined;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) return undefined;
			locals.add(declaration);
		}
	}
	return locals;
}

export function builderOf(node: ts.Node): Builder | undefined {
	if (!isPlainFunction(node) || node.body === undefined) return undefined;
	const { body, parameters } = node;
	if (!ts.isBlock(body)) return { declaration: node, parameters, locals: new Set(), result: body };
	const last = body.statements.at(-1);
	if (last === undefined || !ts.isReturnStatement(last) || last.expression === undefined) return undefined;
	const locals = localsOf(body.statements.slice(0, -1));
	return locals === undefined ? undefined : { declaration: node, parameters, locals, result: last.expression };
}
