import { type Diagnostic, isRecord } from '@chartguard/core';
import ts from 'typescript';

import { Bindings } from './bindings.js';
import { StaticDecoder } from './decoder.js';
import { inMemoryProgram, type ReadOnlyProgram } from './program.js';
import { type Binding, bindingOf } from './scope.js';

export interface SourceObject {
	readonly name: string;
	readonly line: number;
	readonly column: number;
	/** `const` (and `using`) hold their initializer for good; `let`/`var` may be reassigned. */
	readonly binding: Binding;
	readonly value: unknown;
	/** False when any part depends on code that was not executed, or the binding may be reassigned. */
	readonly complete: boolean;
	/** Why this object is incomplete, if it is. Empty when complete. */
	readonly diagnostics: readonly Diagnostic[];
}

export interface AnalysisOutput {
	readonly objects: readonly SourceObject[];
	/** File-level findings: syntax errors. Any syntax error makes every object incomplete. */
	readonly diagnostics: readonly Diagnostic[];
}

interface Position {
	readonly line: number;
	readonly column: number;
}

type ObjectDeclaration = ts.VariableDeclaration & { readonly name: ts.Identifier; readonly initializer: ts.Expression };

function isObjectDeclaration(node: ts.Node): node is ObjectDeclaration {
	return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined;
}

function positionAt(file: ts.SourceFile, offset: number): Position {
	const { line, character } = file.getLineAndCharacterOfPosition(offset);
	return { line: line + 1, column: character + 1 };
}

/** TypeScript recovers from syntax errors and still builds a tree; nothing read from such a tree is reliable. */
function syntaxDiagnostics({ program, file }: ReadOnlyProgram, fileName: string): Diagnostic[] {
	return program.getSyntacticDiagnostics(file).map((problem) => ({
		code: 'CFG_SYNTAX',
		severity: 'warning',
		message: ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
		path: '$',
		confidence: 'unknown',
		file: fileName,
		...positionAt(file, problem.start)
	}));
}

class Collector {
	readonly objects: SourceObject[] = [];

	constructor(
		private readonly file: ts.SourceFile,
		private readonly decoder: StaticDecoder,
		private readonly context: { readonly fileName: string; readonly parses: boolean }
	) {}

	visit(node: ts.Node): void {
		if (isObjectDeclaration(node)) this.collect(node);
		ts.forEachChild(node, (child) => {
			this.visit(child);
		});
	}

	private collect(node: ObjectDeclaration): void {
		const { value, complete: resolved } = this.decoder.decode(node.initializer);
		if (!isRecord(value)) return;
		const name = node.name.text;
		const binding = bindingOf(node);
		const position = positionAt(this.file, node.getStart(this.file));
		const diagnostics = this.reasons(name, binding, resolved, position);
		this.objects.push({ name, ...position, binding, value, complete: diagnostics.length === 0, diagnostics });
	}

	private reasons(name: string, binding: Binding, resolved: boolean, position: Position): Diagnostic[] {
		const note = (code: string, message: string): Diagnostic => ({
			code,
			severity: 'info',
			message,
			path: `$.${name}`,
			confidence: 'unknown',
			file: this.context.fileName,
			...position
		});
		const reasons: Diagnostic[] = [];
		if (!this.context.parses) reasons.push(note('CFG_SYNTAX', `${name} was read from a file with syntax errors.`));
		if (binding !== 'const')
			reasons.push(
				note(
					'CFG_REASSIGNABLE',
					`${name} is declared with ${binding} and may be reassigned; declare it const to analyze it.`
				)
			);
		if (!resolved)
			reasons.push(note('CFG_DYNAMIC', `Expression for ${name} cannot be completely resolved without executing code.`));
		return reasons;
	}
}

/** The objects of the analysed file, read through its Program's checker. */
export function extract(read: ReadOnlyProgram, fileName: string): AnalysisOutput {
	const diagnostics = syntaxDiagnostics(read, fileName);
	const decoder = new StaticDecoder(new Bindings(read.program, read.file));
	const collector = new Collector(read.file, decoder, { fileName, parses: diagnostics.length === 0 });
	collector.visit(read.file);
	return { objects: collector.objects, diagnostics };
}

/**
 * Partial static extraction of one source text on its own: no lib, no imports, no file system.
 * Never evaluates JS; cannot guarantee complete data-flow analysis.
 */
export function extractStaticConfigs(source: string, filename = 'config.ts'): AnalysisOutput {
	return extract(inMemoryProgram(source, filename), filename);
}
