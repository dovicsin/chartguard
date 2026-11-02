import { resolve } from 'node:path';

import type { ChartUse } from '@chartguard/analysis-typescript';
import type { KeyRename, OptionEdit } from '@chartguard/core';
import type { Rule, SourceCode } from 'eslint';

/** A replacement of the text in `range` (offsets into ESLint's text). */
export interface TextEdit {
	readonly range: readonly [number, number];
	readonly text: string;
}

/** The ESTree node kinds an edit walks through, read loosely: every parser ESLint runs builds them. */
interface Node {
	readonly type: string;
	readonly range: readonly [number, number];
	readonly parent?: Node | null;
	readonly [key: string]: unknown;
}

interface Property extends Node {
	readonly type: 'Property';
	readonly key: Node & { readonly name?: unknown; readonly value?: unknown; readonly raw?: unknown };
	readonly value: Node;
}

/** Where an edit is made: the linted file as ESLint holds it, and the use whose config it edits. */
export interface EditSite {
	readonly sourceCode: SourceCode;
	readonly fileName: string;
	readonly use: ChartUse;
}

const offsetOf = (sourceCode: SourceCode, line: number, column: number): number =>
	sourceCode.getIndexFromLoc({ line, column: column - 1 });

/**
 * The node that wrote the value at exactly `path`, never one above it. Edits are made only for a
 * config read completely: every fact is known, and a getter, computed key or spread of an unknown
 * value would have left it partial.
 */
function nodeAt({ sourceCode, fileName, use }: EditSite, path: string): Node | undefined {
	const fact = use.paths.find((candidate) => candidate.path === path);
	// A value another file wrote (project mode) is not this file's to edit.
	if (fact === undefined || resolve(fact.file) !== resolve(fileName)) return undefined;
	const start = offsetOf(sourceCode, fact.line, fact.column);
	const end = offsetOf(sourceCode, fact.endLine, fact.endColumn);
	for (let node = sourceCode.getNodeByRangeIndex(start) as Node | null | undefined; node; node = node.parent)
		if (node.range[0] === start && node.range[1] === end) return node;
	return undefined;
}

const isProperty = (node: Node | null | undefined): node is Property => node?.type === 'Property';

/** A key as the runtime reads it: an identifier or a string literal, else nothing (a number). */
function keyName({ key }: Property): string | undefined {
	if (key.type === 'Identifier' && typeof key.name === 'string') return key.name;
	return key.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined;
}

/** The outermost object or array literal `node` is nested in through literals only. */
function outermostLiteral(node: Node): Node {
	let literal = node;
	for (;;) {
		const up = literal.parent;
		if (isProperty(up) && up.parent) literal = up.parent;
		else if (up?.type === 'ArrayExpression') literal = up;
		else return literal;
	}
}

/**
 * Whether `literal` is written in the call (or a JSX attribute) that hands the config to the
 * library: then no other code holds the object an edit changes, not even a builder in between.
 */
function writtenInUse(sourceCode: SourceCode, use: ChartUse, literal: Node): boolean {
	const holder = literal.parent;
	if (holder?.type === 'CallExpression' || holder?.type === 'NewExpression')
		return holder.range[0] === offsetOf(sourceCode, use.line, use.column);
	return holder?.type === 'JSXExpressionContainer' && holder.parent?.type === 'JSXAttribute';
}

/**
 * The property whose value wrote `path`, when the use's own call writes it and its object sets no
 * other key of that name (the last one wins; an edit of another would change nothing or the wrong one).
 */
function propertyAt(site: EditSite, path: string): Property | undefined {
	const { sourceCode, use } = site;
	const property = nodeAt(site, path)?.parent;
	const object = property?.parent;
	if (!isProperty(property) || object?.type !== 'ObjectExpression') return undefined;
	const name = keyName(property);
	if (name === undefined || !writtenInUse(sourceCode, use, outermostLiteral(object))) return undefined;
	const siblings = object['properties'] as readonly Node[];
	return siblings.filter((other) => isProperty(other) && keyName(other) === name).length === 1 ? property : undefined;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;

/**
 * The runtime's own rename written in source: the key in place, quoted as it was. The engine
 * offers it only while the new key is free in the config read completely, so no other part sets it.
 */
export function renameEdit(site: EditSite, path: string, { to }: KeyRename): TextEdit | undefined {
	const property = propertyAt(site, path);
	if (property === undefined || !IDENTIFIER.test(to)) return undefined;
	const { key } = property;
	const quote = key.type === 'Literal' && typeof key.raw === 'string' ? key.raw.charAt(0) : '';
	return { range: key.range, text: `${quote}${to}${quote}` };
}

/** A quality edit (`set-option`) written in source: the value it replaces, written in the use's own call. */
export function valueEdit(site: EditSite, fix: OptionEdit): TextEdit | undefined {
	const property = propertyAt(site, fix.path);
	return property === undefined ? undefined : { range: property.value.range, text: JSON.stringify(fix.value) };
}

/** ESLint's fixer for an edit. */
export const fixer =
	(edit: TextEdit): Rule.ReportFixer =>
	(rule) =>
		rule.replaceTextRange(edit.range as [number, number], edit.text);
