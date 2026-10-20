import type { Diagnostic } from '@chartguard/core';
import type ts from 'typescript';

import type { Decoded } from './decoded.js';
import { factsOf, type PathFact, type SourceRange } from './trace.js';
import { pathText, type Write } from './writes.js';

export interface Position {
	readonly line: number;
	readonly column: number;
}

export function positionAt(file: ts.SourceFile, offset: number): Position {
	const { line, character } = file.getLineAndCharacterOfPosition(offset);
	return { line: line + 1, column: character + 1 };
}

/** Why a value read from source is not complete: notes, never findings about the chart. */
export class Notes {
	constructor(
		private readonly file: ts.SourceFile,
		/** The analysed file's name as the caller gave it. */
		private readonly fileName: string
	) {}

	note(code: string, message: string, path: string, position: Position): Diagnostic {
		return { code, severity: 'info', message, path, confidence: 'unknown', file: this.fileName, ...position };
	}

	/** A node's range, in the analysed file under the name the caller gave it. */
	rangeOf(node: ts.Node): SourceRange {
		const file = node.getSourceFile();
		const start = positionAt(file, node.getStart(file));
		const end = positionAt(file, node.getEnd());
		return {
			file: file === this.file ? this.fileName : file.fileName,
			...start,
			endLine: end.line,
			endColumn: end.column
		};
	}

	/** The path facts of a decoded value (CG-03-04). */
	factsOf({ value, trace }: Decoded): PathFact[] {
		return factsOf(value, trace, (node) => this.rangeOf(node));
	}

	/** Where code may change the value of `name`: that path is left out (CG-03-05). */
	mutated(name: string, { path, node }: Write): Diagnostic {
		const file = node.getSourceFile();
		const fileName = file === this.file ? this.fileName : file.fileName;
		const position = positionAt(file, node.getStart(file));
		const message = `${name}${pathText(path)} is changed at ${fileName}:${String(position.line)}; its value is not read.`;
		return { ...this.note('CFG_MUTATED', message, `$${pathText(path)}`, position), file: fileName };
	}
}
