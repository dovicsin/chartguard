import ts from 'typescript';

import { type Decoded, known } from './decoded.js';

type TransparentWrapper = ts.ParenthesizedExpression | ts.AsExpression | ts.SatisfiesExpression | ts.TypeAssertion;

type NegativeNumber = ts.PrefixUnaryExpression & { readonly operand: ts.NumericLiteral };

const KEYWORD_LITERALS: ReadonlyMap<ts.SyntaxKind, Decoded> = new Map([
	[ts.SyntaxKind.TrueKeyword, known(true)],
	[ts.SyntaxKind.FalseKeyword, known(false)],
	[ts.SyntaxKind.NullKeyword, known(null)]
]);

/** Syntax that changes only the static type, never the runtime value. */
export function isTransparentWrapper(node: ts.Expression): node is TransparentWrapper {
	return (
		ts.isParenthesizedExpression(node) ||
		ts.isAsExpression(node) ||
		ts.isSatisfiesExpression(node) ||
		ts.isTypeAssertionExpression(node)
	);
}

function isNegativeNumber(node: ts.Expression): node is NegativeNumber {
	return (
		ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)
	);
}

export function decodeLiteral(node: ts.Expression): Decoded | undefined {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return known(node.text);
	if (ts.isNumericLiteral(node)) return known(Number(node.text));
	if (isNegativeNumber(node)) return known(-Number(node.operand.text));
	return KEYWORD_LITERALS.get(node.kind);
}

export function staticKey(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
	return undefined;
}
