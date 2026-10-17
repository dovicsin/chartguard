import ts from 'typescript';

function literalText(node) {
	return node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function isModuleCall(node) {
	if (!ts.isCallExpression(node)) return false;
	const callee = node.expression;
	return callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require');
}

/** The module specifier node a statement or expression refers to, or undefined if it refers to none. */
function moduleReferenceOf(node) {
	if (ts.isImportDeclaration(node)) return { argument: node.moduleSpecifier };
	if (ts.isExportDeclaration(node))
		return node.moduleSpecifier === undefined ? undefined : { argument: node.moduleSpecifier };
	if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference))
		return { argument: node.moduleReference.expression };
	if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return { argument: node.argument.literal };
	if (isModuleCall(node)) return { argument: node.arguments[0] };
	return undefined;
}

/**
 * Every module a source file refers to, found by parsing only; nothing is executed.
 * `specifier` is undefined when the target is computed and cannot be verified statically.
 */
export function moduleReferences(source, fileName) {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	const references = [];
	const visit = (node) => {
		const reference = moduleReferenceOf(node);
		if (reference !== undefined) {
			const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
			references.push({ specifier: literalText(reference.argument), line: line + 1 });
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return references;
}
