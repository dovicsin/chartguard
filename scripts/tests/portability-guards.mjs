import ts from 'typescript';

import { memberOf, offences, stringText } from './syntax-guards.mjs';

/** A name that holds a directory: `ROOT`, `root`, `outDir`, `packageDir`, `directory`. */
const isDirectoryName = (node) => ts.isIdentifier(node) && /(?:root|dir|directory)$/iu.test(node.text);
const hasSeparator = (text) => text.includes('/') || text.includes('\\');

/** `${ROOT}packages/x`: a template where a directory is followed by text with a separator. */
function templatePath(node) {
	if (!ts.isTemplateExpression(node)) return false;
	const start = node.templateSpans.findIndex((span) => isDirectoryName(span.expression));
	return start !== -1 && node.templateSpans.slice(start).some((span) => hasSeparator(span.literal.text));
}

/** The operands of a `+` chain, left to right. */
function operands(node) {
	if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return [node];
	return [...operands(node.left), ...operands(node.right)];
}

/** `root + '/x.json'`: the outermost `+` chain where a directory is followed by text with a separator. */
function concatenatedPath(node) {
	const isPlus = (candidate) =>
		ts.isBinaryExpression(candidate) && candidate.operatorToken.kind === ts.SyntaxKind.PlusToken;
	if (!isPlus(node) || isPlus(node.parent)) return false;
	const parts = operands(node);
	const start = parts.findIndex(isDirectoryName);
	return start !== -1 && parts.slice(start).some((part) => hasSeparator(stringText(part) ?? ''));
}

/** R14 (E2): a path built as text from a root or directory instead of `join` or `new URL`. */
export const rootPathText = (entries) => offences(entries, (node) => templatePath(node) || concatenatedPath(node));

const CI_VARIABLES = new Set(['CI', 'GITHUB_ACTIONS', 'BUILDKITE', 'JENKINS_URL', 'GITLAB_CI', 'TF_BUILD']);

/** `process.env` or a variable named `env`. */
function isEnvironment(node) {
	if (ts.isIdentifier(node)) return node.text === 'env';
	const access = memberOf(node);
	return (
		access !== undefined &&
		ts.isIdentifier(access.object) &&
		access.object.text === 'process' &&
		access.member === 'env'
	);
}

/** `const { CI } = process.env`. */
function isCiBinding(node) {
	if (!ts.isBindingElement(node)) return false;
	const name = node.propertyName ?? node.name;
	const declaration = node.parent.parent;
	return (
		ts.isIdentifier(name) &&
		CI_VARIABLES.has(name.text) &&
		ts.isVariableDeclaration(declaration) &&
		declaration.initializer !== undefined &&
		isEnvironment(declaration.initializer)
	);
}

/** R15 (E22): CI detected by reading a CI variable anywhere but `tools/shared/ci.mjs`. */
export const ciDetection = (entries) =>
	offences(entries, (node) => {
		const access = memberOf(node);
		if (access !== undefined) return CI_VARIABLES.has(access.member) && isEnvironment(access.object);
		return isCiBinding(node);
	});
