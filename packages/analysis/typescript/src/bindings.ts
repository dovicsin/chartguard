import ts from 'typescript';

import { bindingOf, isDynamicScope } from './scope.js';
import { type ChainTarget, WriteIndex } from './write-index.js';
import type { Call, Chain, Write } from './writes.js';

/** What a name is bound to, when a static reader may take it as a value: `undefined`, or an expression to decode. */
export type Target =
	| { readonly kind: 'undefined' }
	| { readonly kind: 'value'; readonly declaration: ts.Node; readonly expression: ts.Expression };

const UNDEFINED: Target = { kind: 'undefined' };

type Constant = ts.VariableDeclaration & { readonly initializer: ts.Expression };

/** A `const` (or `using`) at the top level of its file: its initializer is its value for good (A1). */
function isTopLevelConstant(node: ts.Node): node is Constant {
	return (
		ts.isVariableDeclaration(node) &&
		node.initializer !== undefined &&
		bindingOf(node) === 'const' &&
		ts.isVariableStatement(node.parent.parent) &&
		ts.isSourceFile(node.parent.parent.parent)
	);
}

/**
 * Resolves names and namespace members through the checker, across imports and re-exports
 * (CG-03-03), to the declaration whose value they read. Only readable project files are trusted.
 */
export class Bindings {
	private readonly checker: ts.TypeChecker;
	private readonly readable = new Map<ts.SourceFile, boolean>();
	private readonly writeIndex: WriteIndex;

	constructor(
		private readonly program: ts.Program,
		private readonly file: ts.SourceFile,
		exempt: (call: Call) => boolean
	) {
		this.checker = program.getTypeChecker();
		this.writeIndex = new WriteIndex(
			() => program.getSourceFiles().filter((source) => this.isReadable(source)),
			(chain) => this.writtenConstant(chain),
			exempt
		);
	}

	ofIdentifier(node: ts.Identifier): Target | undefined {
		if (isDynamicScope(node)) return undefined;
		const symbol = this.symbolOf(node);
		// The checker's own `undefined`: no declaration anywhere, so nothing shadows it.
		if (symbol?.name === 'undefined' && (symbol.declarations ?? []).length === 0) return UNDEFINED;
		return this.valueOf(this.followed(symbol));
	}

	/** `ns.name` for a namespace import of a source module; any other object's property may be reassigned. */
	ofMember({ expression, name }: ts.PropertyAccessExpression): Target | undefined {
		if (!ts.isIdentifier(expression) || isDynamicScope(expression)) return undefined;
		const declarations = this.followed(this.checker.getSymbolAtLocation(expression))?.declarations ?? [];
		if (declarations.length === 0 || !declarations.every(ts.isSourceFile)) return undefined;
		return this.valueOf(this.followed(this.checker.getSymbolAtLocation(name)));
	}

	/** Every place readable code may change the constant `declaration` declares (CG-03-05). */
	writesTo(declaration: ts.Node): readonly Write[] {
		return this.writeIndex.writesTo(declaration);
	}

	/** The declaration a written chain starts at (through imports and namespace members), and the path within it. */
	private writtenConstant({ root, accesses }: Chain): ChainTarget | undefined {
		const symbol = this.followed(this.checker.getSymbolAtLocation(root));
		const [first, ...rest] = accesses;
		const declarations = symbol?.declarations ?? [];
		if (first === undefined || declarations.length === 0 || !declarations.every(ts.isSourceFile))
			return this.declared(symbol, accesses);
		const member = ts.isPropertyAccessExpression(first.node) ? first.node.name : first.node.argumentExpression;
		return this.declared(this.followed(this.checker.getSymbolAtLocation(member)), rest);
	}

	private declared(
		symbol: ts.Symbol | undefined,
		accesses: Chain['accesses']
	): ReturnType<Bindings['writtenConstant']> {
		const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.find(ts.isExportAssignment);
		if (declaration === undefined || !(ts.isVariableDeclaration(declaration) || ts.isExportAssignment(declaration)))
			return undefined;
		return { declaration, path: accesses.map(({ step }) => step) };
	}

	/** `{ min }` names the property; the value it reads is the binding `min`. */
	private symbolOf(node: ts.Identifier): ts.Symbol | undefined {
		const { parent } = node;
		if (ts.isShorthandPropertyAssignment(parent) && parent.name === node)
			return this.checker.getShorthandAssignmentValueSymbol(parent);
		return this.checker.getSymbolAtLocation(node);
	}

	/** Through every import, `export { a as b } from`, `export *` and `import x = require()` to what is finally named. */
	private followed(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
		if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
		return this.checker.getAliasedSymbol(symbol);
	}

	/**
	 * A top-level `const`, or a module's `export default`/`export =` expression (neither binding can
	 * be reassigned), in a readable file. A value and a type may share a name: the value is what is read.
	 */
	private valueOf(symbol: ts.Symbol | undefined): Target | undefined {
		const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.find(ts.isExportAssignment);
		if (declaration === undefined || !this.isReadable(declaration.getSourceFile())) return undefined;
		if (isTopLevelConstant(declaration)) return { kind: 'value', declaration, expression: declaration.initializer };
		if (ts.isExportAssignment(declaration)) return { kind: 'value', declaration, expression: declaration.expression };
		return undefined;
	}

	/**
	 * The analysed file, or a project source without syntax errors. Declaration files have no values;
	 * an external library's sources are not the project's, and the bundler may resolve another version.
	 */
	private isReadable(file: ts.SourceFile): boolean {
		if (file === this.file) return true;
		const known = this.readable.get(file);
		if (known !== undefined) return known;
		const readable =
			!file.isDeclarationFile &&
			!this.program.isSourceFileFromExternalLibrary(file) &&
			this.program.getSyntacticDiagnostics(file).length === 0;
		this.readable.set(file, readable);
		return readable;
	}
}
