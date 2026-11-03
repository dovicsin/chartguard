import ts from 'typescript';

import { GLOBAL_OBJECTS, memberOf, offences, stringText } from './syntax-guards.mjs';

/** Code guards for browser code, on the syntax tree like those of syntax-guards.mjs. */

const CODE_FROM_TEXT = new Set(['eval', 'Function']);
const TIMERS = new Set(['setTimeout', 'setInterval']);
const HTML_SINKS = new Set(['innerHTML', 'outerHTML']);

/** The name a callee is reached by: `eval`, or a member of a global object (`globalThis.eval`, `window['Function']`). */
function globalName(node) {
	if (ts.isIdentifier(node)) return node.text;
	const access = memberOf(node);
	if (access === undefined || !ts.isIdentifier(access.object)) return undefined;
	return GLOBAL_OBJECTS.has(access.object.text) ? access.member : undefined;
}

/** A call or `new` that runs text as code: `eval`, `Function`, a timer given a string. */
function runsText(node) {
	if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
	const name = globalName(node.expression);
	if (CODE_FROM_TEXT.has(name)) return true;
	return TIMERS.has(name) && stringText(node.arguments?.[0]) !== undefined;
}

const isAssignment = (node) =>
	ts.isBinaryExpression(node) &&
	node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
	node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;

/** `insertAdjacentHTML(…)` on anything, `write`/`writeln` on `document`. */
function callsMarkup(node) {
	const access = ts.isCallExpression(node) ? memberOf(node.expression) : undefined;
	if (access === undefined) return false;
	if (access.member === 'insertAdjacentHTML') return true;
	const onDocument = ts.isIdentifier(access.object) && access.object.text === 'document';
	return onDocument && (access.member === 'write' || access.member === 'writeln');
}

/** Markup parsed from text: `innerHTML`/`outerHTML` written, `insertAdjacentHTML`, `document.write`. */
function parsesMarkup(node) {
	if (isAssignment(node)) return HTML_SINKS.has(memberOf(node.left)?.member);
	return callsMarkup(node);
}

/**
 * R18: code or markup made from text in browser code (E19: `textContent` only, no eval, strict CSP):
 * `eval`, `Function`, a timer given a string, `innerHTML`/`outerHTML` written, `insertAdjacentHTML`,
 * `document.write`. A comment or a string that names them is no offence (the analysis detects `eval`).
 */
export const codeFromText = (entries) => offences(entries, (node) => runsText(node) || parsesMarkup(node));
