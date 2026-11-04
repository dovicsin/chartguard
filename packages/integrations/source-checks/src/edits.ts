import type { ChartUse, SourceRange } from '@chartguard/analysis-typescript';
import type { KeyRename, OptionEdit } from '@chartguard/core';
import ts from 'typescript';

/** A replacement of the text from `start` to `end` (offsets into the checked text). */
export interface TextEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/**
 * Where an edit is made: the checked text as TypeScript parses it, whether a range the analysis read
 * is in it (the caller compares file names its own way), and the use whose config it edits.
 */
export interface EditSite {
	readonly file: ts.SourceFile;
	readonly inFile: (range: SourceRange) => boolean;
	readonly use: ChartUse;
}

/** An offset from the analysis' 1-based line and column, counted as TypeScript counts lines. */
export const offsetOf = (file: ts.SourceFile, line: number, column: number): number =>
	ts.getPositionOfLineAndCharacter(file, line - 1, column - 1);

/** The deepest node of `file` whose text (with its leading trivia) contains `position`; callers walk up to the exact node. */
function deepestAt(file: ts.SourceFile, position: number): ts.Node {
	let node: ts.Node = file;
	for (;;) {
		const child = node.getChildren(file).find((candidate) => candidate.pos <= position && position < candidate.end);
		if (child === undefined) return node;
		node = child;
	}
}

/**
 * The node that wrote the value at exactly `path`, never one above it, in the checked file only (a
 * value another file wrote is not this file's to edit). Edits are made only for a config read
 * completely: a getter, computed key or spread of an unknown value would have left it partial.
 */
function nodeAt({ file, inFile, use }: EditSite, path: string): ts.Node | undefined {
	const fact = use.paths.find((candidate) => candidate.path === path);
	if (fact === undefined || !inFile(fact)) return undefined;
	const start = offsetOf(file, fact.line, fact.column);
	const end = offsetOf(file, fact.endLine, fact.endColumn);
	// The source file's parent is undefined at run time, whatever the declarations say.
	for (let node = deepestAt(file, start); ; node = node.parent) {
		if (node.getStart(file) === start && node.end === end) return node;
		if (ts.isSourceFile(node)) return undefined;
	}
}

/** A key as the runtime reads it: an identifier or a string literal, else nothing (computed, numeric). */
function keyName({ name }: ts.PropertyAssignment): string | undefined {
	return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** The outermost object or array literal `node` is nested in through literals only (no parentheses, no `as`). */
function outermostLiteral(node: ts.Node): ts.Node {
	let literal = node;
	for (;;) {
		const up = literal.parent;
		if (ts.isPropertyAssignment(up) && up.initializer === literal) literal = up.parent;
		else if (ts.isArrayLiteralExpression(up)) literal = up;
		else return literal;
	}
}

/**
 * Whether `literal` is written in the call (or a JSX attribute) that hands the config to the
 * library: then no other code holds the object an edit changes, not even a builder in between.
 */
function writtenInUse({ file, use }: EditSite, literal: ts.Node): boolean {
	const holder = literal.parent;
	if (ts.isCallExpression(holder) || ts.isNewExpression(holder))
		return holder.getStart(file) === offsetOf(file, use.line, use.column);
	return ts.isJsxExpression(holder) && ts.isJsxAttribute(holder.parent);
}

/** The object literal that wrote the value at `path`, when the use's own call writes it. */
export function objectWrittenInUse(site: EditSite, path: string): ts.ObjectLiteralExpression | undefined {
	const node = nodeAt(site, path);
	if (node === undefined || !ts.isObjectLiteralExpression(node)) return undefined;
	return writtenInUse(site, outermostLiteral(node)) ? node : undefined;
}

/**
 * The property whose value wrote `path`, when the use's own call writes it and its object sets no
 * other key of that name (the last one wins; an edit of another would change nothing or the wrong one).
 */
function propertyAt(site: EditSite, path: string): ts.PropertyAssignment | undefined {
	const property = nodeAt(site, path)?.parent;
	if (property === undefined || !ts.isPropertyAssignment(property)) return undefined;
	const name = keyName(property);
	const object = property.parent;
	if (name === undefined || !writtenInUse(site, outermostLiteral(object))) return undefined;
	const named = object.properties.filter((other) => ts.isPropertyAssignment(other) && keyName(other) === name);
	return named.length === 1 ? property : undefined;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/**
 * The runtime's own rename written in source: the key in place, quoted as it was. The engine
 * offers it only while the new key is free in the config read completely, so no other part sets it.
 */
export function renameEdit(site: EditSite, path: string, { to }: KeyRename): TextEdit | undefined {
	const property = propertyAt(site, path);
	if (property === undefined || !IDENTIFIER.test(to)) return undefined;
	const { name } = property;
	const start = name.getStart(site.file);
	const quote = ts.isStringLiteral(name) ? site.file.text.charAt(start) : '';
	return { start, end: name.end, text: `${quote}${to}${quote}` };
}

/** A quality edit (`set-option`) written in source: the value it replaces, written in the use's own call. */
export function valueEdit(site: EditSite, fix: OptionEdit): TextEdit | undefined {
	const property = propertyAt(site, fix.path);
	if (property === undefined) return undefined;
	const { initializer } = property;
	return { start: initializer.getStart(site.file), end: initializer.end, text: JSON.stringify(fix.value) };
}
