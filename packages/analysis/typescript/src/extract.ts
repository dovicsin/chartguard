import { type Diagnostic, isRecord } from '@chartguard/core';
import ts from 'typescript';

import { Bindings } from './bindings.js';
import { StaticDecoder } from './decoder.js';
import { UseDetector } from './detector.js';
import { Notes, positionAt } from './notes.js';
import { Origins } from './origins.js';
import { type ChartPattern, rulesOf } from './patterns.js';
import { inMemoryProgram, type ReadOnlyProgram } from './program.js';
import { type Binding, bindingOf } from './scope.js';
import { type ChartUse, UseCollector } from './uses.js';
import { isPureCall, withoutWritten } from './writes.js';

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
	/** Where the file hands a config to a chart library (CG-03-06). */
	readonly uses: readonly ChartUse[];
	/** File-level findings: syntax errors. Any syntax error makes every object incomplete. */
	readonly diagnostics: readonly Diagnostic[];
}

export interface ExtractOptions {
	/** A project's own wrappers, added to the built-in library patterns; malformed ones throw `PatternError`. */
	readonly patterns?: readonly ChartPattern[];
}

type ObjectDeclaration = ts.VariableDeclaration & { readonly name: ts.Identifier; readonly initializer: ts.Expression };

function isObjectDeclaration(node: ts.Node): node is ObjectDeclaration {
	return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined;
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

/** What every reader of the analysed file shares. */
interface Reader {
	readonly decoder: StaticDecoder;
	readonly bindings: Bindings;
	readonly notes: Notes;
}

class Collector {
	readonly objects: SourceObject[] = [];

	constructor(
		private readonly file: ts.SourceFile,
		private readonly reader: Reader,
		private readonly parses: boolean
	) {}

	collect(node: ts.Node): void {
		if (isObjectDeclaration(node)) this.collectObject(node);
	}

	private collectObject(node: ObjectDeclaration): void {
		const { decoder, bindings, notes } = this.reader;
		const initial = decoder.decode(node.initializer);
		const writes = bindings.writesTo(node);
		const { value } = withoutWritten(initial, writes);
		if (!isRecord(value)) return;
		const name = node.name.text;
		const binding = bindingOf(node);
		const position = positionAt(this.file, node.getStart(this.file));
		const note = (code: string, message: string): Diagnostic => notes.note(code, message, `$.${name}`, position);
		const reassignable = `${name} is declared with ${binding} and may be reassigned; declare it const to analyze it.`;
		const diagnostics = [
			...(this.parses ? [] : [note('CFG_SYNTAX', `${name} was read from a file with syntax errors.`)]),
			...(binding === 'const' ? [] : [note('CFG_REASSIGNABLE', reassignable)]),
			...(initial.complete
				? []
				: [note('CFG_DYNAMIC', `Expression for ${name} cannot be completely resolved without executing code.`)]),
			...writes.map((write) => notes.mutated(name, write))
		];
		this.objects.push({ name, ...position, binding, value, complete: diagnostics.length === 0, diagnostics });
	}
}

/** The objects and chart uses of the analysed file, read through its Program's checker. */
export function extract(
	read: ReadOnlyProgram,
	fileName: string,
	{ patterns = [] }: ExtractOptions = {}
): AnalysisOutput {
	const rules = rulesOf(patterns);
	const diagnostics = syntaxDiagnostics(read, fileName);
	const parses = diagnostics.length === 0;
	const detector = new UseDetector(new Origins(read.program), rules, read.program.getTypeChecker());
	// A chart use or a pure global leaves what it is given as it is; any other callee may change it.
	const exempt = (call: ts.CallExpression | ts.NewExpression): boolean =>
		detector.matchCall(call) !== undefined || isPureCall(call, read.program);
	const bindings = new Bindings(read.program, read.file, exempt);
	const reader = { decoder: new StaticDecoder(bindings), bindings, notes: new Notes(read.file, fileName) };
	const objects = new Collector(read.file, reader, parses);
	const uses = new UseCollector(detector, reader, parses);
	const visit = (node: ts.Node): void => {
		objects.collect(node);
		uses.visit(node);
		ts.forEachChild(node, visit);
	};
	visit(read.file);
	return { objects: objects.objects, uses: uses.uses, diagnostics };
}

/**
 * Partial static extraction of one source text on its own: no lib, no imports, no file system.
 * Never evaluates JS; cannot guarantee complete data-flow analysis.
 */
export function extractStaticConfigs(
	source: string,
	filename = 'config.ts',
	options: ExtractOptions = {}
): AnalysisOutput {
	return extract(inMemoryProgram(source, filename), filename, options);
}
