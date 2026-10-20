import { type Diagnostic, isRecord } from '@chartguard/core';
import ts from 'typescript';

import { Bindings } from './bindings.js';
import { StaticDecoder } from './decoder.js';
import { UseDetector } from './detector.js';
import { guarded, inputRefusal, truncation } from './limits.js';
import { Notes, positionAt } from './notes.js';
import { Origins } from './origins.js';
import { type ChartPattern, rulesOf } from './patterns.js';
import { inMemoryProgram } from './program.js';
import { type Binding, bindingOf } from './scope.js';
import type { PathFact } from './trace.js';
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
	/** Where each path of the value comes from in source, or why it is unknown (CG-03-04). */
	readonly paths: readonly PathFact[];
}

export interface AnalysisOutput {
	/** False when nothing read from the file is reliable: syntax errors, or a file too large or too deep to read. */
	readonly readable: boolean;
	readonly objects: readonly SourceObject[];
	/** Where the file hands a config to a chart library (CG-03-06). */
	readonly uses: readonly ChartUse[];
	/** File-level findings: syntax errors, refusals (CG-03-08), the work limit. */
	readonly diagnostics: readonly Diagnostic[];
}

export interface ExtractOptions {
	/** A project's own wrappers, added to the built-in library patterns; malformed ones throw `PatternError`. */
	readonly patterns?: readonly ChartPattern[];
}

/** One file of a Program to analyse, and the name the caller knows it by. */
export interface AnalysedFile {
	readonly file: ts.SourceFile;
	readonly fileName: string;
}

/** The output for a file that is not read at all (CG-03-08). */
export function refused(diagnostic: Diagnostic): AnalysisOutput {
	return { readable: false, objects: [], uses: [], diagnostics: [diagnostic] };
}

type ObjectDeclaration = ts.VariableDeclaration & { readonly name: ts.Identifier; readonly initializer: ts.Expression };

function isObjectDeclaration(node: ts.Node): node is ObjectDeclaration {
	return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined;
}

/** TypeScript recovers from syntax errors and still builds a tree; nothing read from such a tree is reliable. */
function syntaxDiagnostics(program: ts.Program, { file, fileName }: AnalysedFile): Diagnostic[] {
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
		const read = withoutWritten(initial, writes);
		const { value } = read;
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
		const complete = diagnostics.length === 0;
		this.objects.push({ name, ...position, binding, value, complete, diagnostics, paths: notes.factsOf(read) });
	}
}

/**
 * The reading of one Program: what its files share (patterns, origins, bindings and the writes of
 * every readable file), so several files of a project are analysed together and see each other's writes.
 */
export class Extraction {
	private readonly detector: UseDetector;
	private readonly bindings: Bindings;

	constructor(
		private readonly program: ts.Program,
		{ patterns = [] }: ExtractOptions = {}
	) {
		this.detector = new UseDetector(new Origins(program), rulesOf(patterns), program.getTypeChecker());
		// A chart use or a pure global leaves what it is given as it is; any other callee may change it.
		const exempt = (call: ts.CallExpression | ts.NewExpression): boolean =>
			this.detector.matchCall(call) !== undefined || isPureCall(call, program);
		this.bindings = new Bindings(program, exempt);
	}

	/** The objects and chart uses of one analysed file, read through the Program's checker. */
	read(analysed: AnalysedFile): AnalysisOutput {
		const { file, fileName } = analysed;
		const diagnostics = syntaxDiagnostics(this.program, analysed);
		const readable = diagnostics.length === 0;
		const decoder = new StaticDecoder(this.bindings);
		const reader = { decoder, bindings: this.bindings, notes: new Notes(file, fileName) };
		const objects = new Collector(file, reader, readable);
		const uses = new UseCollector(this.detector, reader, readable);
		const visit = (node: ts.Node): void => {
			objects.collect(node);
			uses.visit(node);
			ts.forEachChild(node, visit);
		};
		visit(file);
		const limit = decoder.exhausted ? [truncation(fileName)] : [];
		return { readable, objects: objects.objects, uses: uses.uses, diagnostics: [...diagnostics, ...limit] };
	}
}

/**
 * Partial static extraction of one source text on its own: no lib, no imports, no file system.
 * Never evaluates JS; cannot guarantee complete data-flow analysis. A file too large or nested too
 * deeply is refused with a note (CG-03-08); malformed patterns throw `PatternError`.
 */
export function extractStaticConfigs(
	source: string,
	filename = 'config.ts',
	options: ExtractOptions = {}
): AnalysisOutput {
	rulesOf(options.patterns);
	const refusal = inputRefusal(source, filename);
	if (refusal !== undefined) return refused(refusal);
	return guarded(
		filename,
		() => {
			const { program, file } = inMemoryProgram(source, filename);
			return new Extraction(program, options).read({ file, fileName: filename });
		},
		refused
	);
}
