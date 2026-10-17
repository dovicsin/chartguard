import { type Diagnostic, isRecord } from '@chartguard/core';
import ts from 'typescript';

import { StaticDecoder } from './decoder.js';

export interface SourceObject {
	name: string;
	line: number;
	column: number;
	value: unknown;
	complete: boolean;
}

export interface AnalysisOutput {
	objects: SourceObject[];
	diagnostics: Diagnostic[];
}

function parse(source: string, filename: string): ts.SourceFile {
	const kind = filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind);
}

function topLevelInitializers(file: ts.SourceFile): Map<string, ts.Expression> {
	const symbols = new Map<string, ts.Expression>();
	for (const statement of file.statements.filter(ts.isVariableStatement))
		for (const { name, initializer } of statement.declarationList.declarations)
			if (ts.isIdentifier(name) && initializer !== undefined) symbols.set(name.text, initializer);
	return symbols;
}

function toSourceObject(node: ts.Node, file: ts.SourceFile, decoder: StaticDecoder): SourceObject | undefined {
	if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.initializer === undefined)
		return undefined;
	const { value, complete } = decoder.decode(node.initializer);
	if (!isRecord(value)) return undefined;
	const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));
	return { name: node.name.text, line: line + 1, column: character + 1, value, complete };
}

function collectObjects(file: ts.SourceFile, decoder: StaticDecoder): SourceObject[] {
	const objects: SourceObject[] = [];
	const visit = (node: ts.Node): void => {
		const object = toSourceObject(node, file, decoder);
		if (object !== undefined) objects.push(object);
		ts.forEachChild(node, visit);
	};
	visit(file);
	return objects;
}

function dynamicDiagnostic(object: SourceObject, filename: string): Diagnostic {
	return {
		code: 'CFG_DYNAMIC',
		severity: 'info',
		message: `Expression for ${object.name} cannot be completely resolved without executing code.`,
		path: `$.${object.name}`,
		confidence: 'unknown',
		file: filename,
		line: object.line,
		column: object.column
	};
}

/** Partial static extraction ONLY. Never evaluates JS; cannot guarantee complete data-flow analysis. */
export function extractStaticConfigs(source: string, filename = 'config.ts'): AnalysisOutput {
	const file = parse(source, filename);
	const objects = collectObjects(file, new StaticDecoder(topLevelInitializers(file)));
	const diagnostics = objects.filter((object) => !object.complete).map((object) => dynamicDiagnostic(object, filename));
	return { objects, diagnostics };
}
