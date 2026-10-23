import { posix, sep } from 'node:path';

import ts from 'typescript';

/**
 * The code guards of code-guards.test.mjs as checks on the syntax tree, not on the text: a guard
 * matches what the code does however it is spelled (H12). Each takes `{ path, text }` entries and
 * returns `path:line` of every offence, so each can be tested on code that must and must not pass.
 */

const kindOf = (path) => (path.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);

function parse({ path, text }) {
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
}

function visitAll(node, visit) {
	visit(node);
	ts.forEachChild(node, (child) => visitAll(child, visit));
}

/** `path:line` of every node of every entry `matches` accepts. */
function offences(entries, matches) {
	return entries.flatMap((entry) => {
		const source = parse(entry);
		const found = [];
		visitAll(source, (node) => {
			if (matches(node, source)) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
				found.push(`${entry.path}:${String(line + 1)}`);
			}
		});
		return found;
	});
}

/** The text of a string literal or of any part of a template literal; undefined for other nodes. */
function stringText(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
	return undefined;
}

/** A property name as written: an identifier, a string or a number; undefined when computed. */
function nameOf(name) {
	if (name === undefined) return undefined;
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
	if (ts.isComputedPropertyName(name)) return stringText(name.expression);
	return undefined;
}

/** The object and member name of `a.b` or `a['b']`; undefined for anything else. */
function memberOf(node) {
	if (ts.isPropertyAccessExpression(node)) return { object: node.expression, member: node.name.text };
	if (ts.isElementAccessExpression(node))
		return { object: node.expression, member: stringText(node.argumentExpression) };
	return undefined;
}

/** `process.argv`, however it is reached (`process.argv`, `process['argv']`). */
function isProcessArgv(node) {
	const access = memberOf(node);
	return (
		access !== undefined &&
		ts.isIdentifier(access.object) &&
		access.object.text === 'process' &&
		access.member === 'argv'
	);
}

/** R1: a diagnostic code of another package (`CFG_`, `VIS_`, `AST_`) in any string, even a prefix. */
export const codeNames = (entries) => offences(entries, (node) => /(?:CFG|VIS|AST)_/u.test(stringText(node) ?? ''));

const RESULT_FIELDS = new Set(['valid', 'status']);

/** R2: `valid` or `status` written into an object (a property, a shorthand, an assignment). */
export const resultFields = (entries) =>
	offences(entries, (node) => {
		if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node))
			return ts.isObjectLiteralExpression(node.parent) && RESULT_FIELDS.has(nameOf(node.name));
		if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
		const target = node.left;
		if (ts.isPropertyAccessExpression(target)) return RESULT_FIELDS.has(target.name.text);
		return ts.isElementAccessExpression(target) && RESULT_FIELDS.has(stringText(target.argumentExpression));
	});

/** R3: a `file://` URL built as text, to compare with the main module or anything else. */
export const fileUrlText = (entries) => offences(entries, (node) => (stringText(node) ?? '').startsWith('file:'));

/** R8: `process.argv[1]` (or `.at(1)`) read anywhere but the guarded helpers. */
export const argvScript = (entries) =>
	offences(entries, (node) => {
		if (ts.isElementAccessExpression(node))
			return (
				isProcessArgv(node.expression) &&
				ts.isNumericLiteral(node.argumentExpression) &&
				node.argumentExpression.text === '1'
			);
		return (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'at' &&
			isProcessArgv(node.expression.expression) &&
			node.arguments.length === 1 &&
			ts.isNumericLiteral(node.arguments[0]) &&
			node.arguments[0].text === '1'
		);
	});

/** Whether a top-level statement is `[await] runAsEntryPoint(…)`. */
function isEntryCall(statement) {
	if (!ts.isExpressionStatement(statement)) return false;
	const expression = ts.isAwaitExpression(statement.expression)
		? statement.expression.expression
		: statement.expression;
	return (
		ts.isCallExpression(expression) &&
		ts.isIdentifier(expression.expression) &&
		expression.expression.text === 'runAsEntryPoint'
	);
}

const SIDE_EFFECTS = new Set([
	ts.SyntaxKind.ExpressionStatement,
	ts.SyntaxKind.IfStatement,
	ts.SyntaxKind.ForStatement,
	ts.SyntaxKind.ForOfStatement,
	ts.SyntaxKind.ForInStatement,
	ts.SyntaxKind.WhileStatement,
	ts.SyntaxKind.DoStatement,
	ts.SyntaxKind.TryStatement,
	ts.SyntaxKind.SwitchStatement,
	ts.SyntaxKind.Block
]);

/** The module a node imports: an import or re-export, or a dynamic import of a string. */
function specifierOf(node) {
	if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
		return node.moduleSpecifier === undefined ? undefined : stringText(node.moduleSpecifier);
	if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
		return stringText(node.arguments[0]);
	return undefined;
}

/** The modules `entries` import with a relative specifier (static, re-exported or dynamic with a string), by path. */
function importedPaths(entries) {
	const imported = new Set();
	for (const entry of entries) {
		const directory = posix.dirname(entry.path.split(sep).join('/'));
		visitAll(parse(entry), (node) => {
			const specifier = specifierOf(node);
			if (specifier?.startsWith('.') === true) imported.add(posix.join(directory, specifier));
		});
	}
	return imported;
}

const callsEntry = (entry) => parse(entry).statements.some(isEntryCall);

/**
 * The scripts among `candidates`: a module no module of `all` imports is run, so it is a script;
 * so is one that calls `runAsEntryPoint`. The rest are libraries, which may set up on import.
 */
export function scriptsAmong(candidates, all) {
	const imported = importedPaths(all);
	return candidates.filter((entry) => !imported.has(entry.path.split(sep).join('/')) || callsEntry(entry));
}

/**
 * R9: a script does its work only in the entry branch: no top-level statement but declarations,
 * imports, exports and `runAsEntryPoint(…)`, which it calls; `isEntryPoint` is called only by that helper.
 */
export function entryWork(scripts) {
	const missing = scripts.filter((entry) => !callsEntry(entry)).map(({ path }) => `${path}:1`);
	const work = offences(scripts, (node, source) => {
		if (node.parent === source && SIDE_EFFECTS.has(node.kind)) return !isEntryCall(node);
		return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'isEntryPoint';
	});
	return [...missing, ...work];
}

const isTemplatePart = (node) => ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
const isArgument = (node, parent) =>
	(ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(node) === true;
const isConcatenated = (parent) =>
	ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken;

/** Whether `node` is where a path is built or handed over: a call or `new` argument, a template, a `+`. */
function buildsPath(node) {
	const { parent } = node;
	if (isTemplatePart(node) || ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)) return true;
	return isArgument(node, parent) || isConcatenated(parent);
}

/** R10: a path into `node_modules` built by hand (an argument, a template, a concatenation). */
export const nodeModulesPaths = (entries) =>
	offences(entries, (node) => (stringText(node) ?? '').includes('node_modules') && buildsPath(node));

/** Whether a type mentions `Record` or an index signature anywhere (`Partial<Record<…>>`, `{ [k: string]: … }`). */
function isRecordType(type) {
	let found = false;
	visitAll(type, (node) => {
		if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Record') found = true;
		if (ts.isIndexSignatureDeclaration(node)) found = true;
	});
	return found;
}

/** R13: the config cast to a record type, which reads through getters and prototypes. */
export const recordCasts = (entries) =>
	offences(
		entries,
		(node) => (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && isRecordType(node.type)
	);

/** R11: a value cloned by a JSON round trip, which silently drops functions and `undefined`. */
export const jsonRoundTrips = (entries) =>
	offences(entries, (node) => {
		const isJson = (call, name) =>
			ts.isCallExpression(call) &&
			ts.isPropertyAccessExpression(call.expression) &&
			ts.isIdentifier(call.expression.expression) &&
			call.expression.expression.text === 'JSON' &&
			call.expression.name.text === name;
		return isJson(node, 'stringify') && node.arguments.length > 0 && isJson(node.arguments[0], 'parse');
	});

const REWRITING = new Set(['--write', '-w', '--fix', '--fix-dry-run', 'update-index', '--apply']);

/**
 * R4: whether a hook or script command may write: a writing flag, a `fix` command or script name,
 * `git add`, or an npm script that does (followed through `npm run`). Shell text, read as words.
 */
export function rewritesFiles(command, scripts = {}, seen = new Set()) {
	const words = command.split(/[\s;&|()"'`]+/u).filter((word) => word !== '');
	return words.some((word, index) => {
		if (REWRITING.has(word) || /(?:^|[:-])fix(?:$|[:-])/u.test(word)) return true;
		if (word === 'add' && words[index - 1] === 'git') return true;
		const script = word === 'run' && words[index - 1] === 'npm' ? words[index + 1] : undefined;
		if (script === undefined || seen.has(script) || typeof scripts[script] !== 'string') return false;
		seen.add(script);
		return rewritesFiles(scripts[script], scripts, seen);
	});
}
