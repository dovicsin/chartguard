import ts from 'typescript';

import { type Builder, builderOf } from './builders.js';
import { unwrapped } from './literals.js';
import { bindingOf, isDynamicScope } from './scope.js';
import { type CallResult, type ChainTarget, WriteIndex } from './write-index.js';
import { type Call, type Chain, passedChains, type Step, unreadableSites, type Write, writeSites } from './writes.js';

/** What a name is bound to, when a static reader may take it as a value: `undefined`, or an expression to decode. */
export type Target =
	| { readonly kind: 'undefined' }
	| { readonly kind: 'value'; readonly declaration: ts.Node; readonly expression: ts.Expression };

const UNDEFINED: Target = { kind: 'undefined' };

type Constant = ts.VariableDeclaration & { readonly initializer: ts.Expression };

/** The step a binding element reads from its pattern's value; undefined for a rest element or a computed name. */
function bindingStep(element: ts.BindingElement): Step | undefined {
	const pattern = element.parent;
	if (element.dotDotDotToken !== undefined) return undefined;
	if (ts.isArrayBindingPattern(pattern)) return { key: String(pattern.elements.indexOf(element)), index: true };
	const name = element.propertyName ?? element.name;
	return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
		? { key: name.text, index: false }
		: undefined;
}

/**
 * Where a write through a destructured binding lands (A37, A39): the variable the pattern destructures,
 * at the path the binding was read from. Below a rest element or a computed name the key is not known:
 * the write reaches everything there. A binding in a parameter is reached through the call instead.
 */
function bindingTargets(element: ts.BindingElement, accesses: readonly Step[], cut: boolean): ChainTarget[] {
	let path: Step[] = [];
	let known = !cut;
	let node: ts.Node = element;
	while (ts.isBindingElement(node)) {
		const step = bindingStep(node);
		if (step === undefined) {
			path = [];
			known = false;
		} else path.unshift(step);
		node = node.parent.parent;
	}
	if (!ts.isVariableDeclaration(node)) return [];
	if (!known) return [{ declaration: node, path, inside: true }];
	return [{ declaration: node, path: [...path, ...accesses], ...(accesses.length === 0 ? { rebinds: true } : {}) }];
}

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
/** A declaration a write through a name lands on: a variable, a default export or a function. */
const isNamed = (declaration: ts.Node): boolean =>
	ts.isVariableDeclaration(declaration) || ts.isExportAssignment(declaration) || ts.isFunctionDeclaration(declaration);

/** Whether a write to the bare loop variable of a `for…of` rebinds it, writing nothing it iterates. */
const rebindsLoop = (declaration: ts.Node, path: readonly unknown[], cut: boolean): boolean =>
	ts.isVariableDeclaration(declaration) && ts.isForOfStatement(declaration.parent.parent) && path.length === 0 && !cut;

export class Bindings {
	private readonly checker: ts.TypeChecker;
	private readonly readable = new Map<ts.SourceFile, boolean>();
	private readonly writeIndex: WriteIndex;
	private reassigned: ReadonlySet<ts.Node> | undefined;

	constructor(
		private readonly program: ts.Program,
		exempt: (call: Call) => boolean
	) {
		this.checker = program.getTypeChecker();
		this.writeIndex = new WriteIndex(
			{ readable: () => this.projectFiles(true), unreadable: () => this.projectFiles(false) },
			(chain) => this.writtenConstants(chain),
			exempt,
			(call) => this.sharesOfCall(call)
		);
	}

	ofIdentifier(node: ts.Identifier): Target | undefined {
		if (isDynamicScope(node)) return undefined;
		const symbol = this.symbolOf(node);
		// The checker's own `undefined`: no declaration anywhere, so nothing shadows it.
		if (symbol?.name === 'undefined' && (symbol.declarations ?? []).length === 0) return UNDEFINED;
		return this.valueOf(this.followed(symbol));
	}

	/** The value of a namespace member (`memberSymbol`). */
	ofMember(node: ts.PropertyAccessExpression): Target | undefined {
		return this.valueOf(this.memberSymbol(node));
	}

	/** `ns.name` for a namespace import of a source module; any other object's property may be reassigned. */
	private memberSymbol({ expression, name }: ts.PropertyAccessExpression): ts.Symbol | undefined {
		if (!ts.isIdentifier(expression) || isDynamicScope(expression)) return undefined;
		const declarations = this.followed(this.checker.getSymbolAtLocation(expression))?.declarations ?? [];
		if (declarations.length === 0 || !declarations.every(ts.isSourceFile)) return undefined;
		return this.followed(this.checker.getSymbolAtLocation(name));
	}

	/** Every place readable code may change the constant `declaration` declares (CG-03-05). */
	writesTo(declaration: ts.Node): readonly Write[] {
		return this.writeIndex.writesTo(declaration);
	}

	/**
	 * The declarations a written chain may start at (through imports and namespace members), and the
	 * path within each. A namespace whose member is not named statically (`ns[name]`, or the namespace
	 * itself handed on) may reach every export of its module.
	 */
	private writtenConstants({ root, accesses, cut = false }: Chain): ChainTarget[] {
		const symbol = this.followed(this.checker.getSymbolAtLocation(root));
		if (symbol === undefined) return [];
		const [first, ...rest] = accesses;
		const declarations = symbol.declarations ?? [];
		if (declarations.length === 0 || !declarations.every(ts.isSourceFile)) return this.declared(symbol, accesses, cut);
		if (first === undefined)
			return this.checker
				.getExportsOfModule(symbol)
				.flatMap((exported) => this.declared(this.followed(exported), [], true));
		const member = ts.isPropertyAccessExpression(first.node) ? first.node.name : first.node.argumentExpression;
		return this.declared(this.followed(this.checker.getSymbolAtLocation(member)), rest, cut);
	}

	/**
	 * Where a name's writes land: its variable (or a function, which can be reassigned, or a module's
	 * default export); for a destructured binding, the variable it was read from at the binding's path.
	 */
	private declared(symbol: ts.Symbol | undefined, accesses: Chain['accesses'], cut: boolean): ChainTarget[] {
		const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.find(ts.isExportAssignment);
		if (declaration === undefined) return [];
		const path = accesses.map(({ step }) => step);
		if (ts.isBindingElement(declaration)) return bindingTargets(declaration, path, cut);
		if (!isNamed(declaration)) return [];
		return [{ declaration, path, ...(rebindsLoop(declaration, path, cut) ? { rebinds: true } : {}) }];
	}

	/** The declaration a name is bound to in its own scope, before following imports; none in a dynamic scope. */
	declarationAt(node: ts.Identifier): ts.Node | undefined {
		return isDynamicScope(node) ? undefined : this.symbolOf(node)?.valueDeclaration;
	}

	/**
	 * The builder a callee names (CG-03-05): a plain function that is never assigned to, or a `const`
	 * function, in a readable file (A1: a function declaration is a variable code may replace).
	 */
	builderAt(callee: ts.Expression): Builder | undefined {
		const declaration = this.calleeSymbol(callee)?.valueDeclaration;
		if (declaration === undefined || !this.isReadable(declaration.getSourceFile())) return undefined;
		if (ts.isFunctionDeclaration(declaration))
			return this.reassignedFunctions().has(declaration) ? undefined : builderOf(declaration);
		const isConstFunction =
			ts.isVariableDeclaration(declaration) &&
			bindingOf(declaration) === 'const' &&
			declaration.initializer !== undefined;
		return isConstFunction ? builderOf(declaration.initializer) : undefined;
	}

	/**
	 * The function declarations code may assign a new value to (A1): an assignment to the bare name,
	 * a direct `eval` in their file, or a file whose syntax cannot be read that imports them. Found
	 * from write sites alone, without the write index, which consults builders while it is built.
	 */
	private reassignedFunctions(): ReadonlySet<ts.Node> {
		if (this.reassigned !== undefined) return this.reassigned;
		const found = new Set<ts.Node>();
		const sites = [
			...this.projectFiles(true).flatMap((file) => writeSites(file, () => true)),
			...this.projectFiles(false).flatMap(unreadableSites)
		];
		for (const { chain, replaces } of sites) {
			if (!replaces || chain.accesses.length > 0) continue;
			const declaration = this.followed(this.checker.getSymbolAtLocation(chain.root))?.valueDeclaration;
			if (declaration !== undefined && ts.isFunctionDeclaration(declaration)) found.add(declaration);
		}
		this.reassigned = found;
		return found;
	}

	/** The project's own source files (not declarations, not external libraries) that are readable, or not. */
	private projectFiles(readable: boolean): ts.SourceFile[] {
		return this.program
			.getSourceFiles()
			.filter(
				(source) =>
					!source.isDeclarationFile &&
					!this.program.isSourceFileFromExternalLibrary(source) &&
					this.isReadable(source) === readable
			);
	}

	/** A callee's symbol: a name outside a dynamic scope, or a namespace member. */
	private calleeSymbol(callee: ts.Expression): ts.Symbol | undefined {
		if (ts.isPropertyAccessExpression(callee)) return this.memberSymbol(callee);
		if (!ts.isIdentifier(callee) || isDynamicScope(callee)) return undefined;
		return this.followed(this.checker.getSymbolAtLocation(callee));
	}

	/**
	 * What a call's result may share with constants: what it is given, and every constant a builder's
	 * body reads. A write inside the result may change them.
	 */
	sharesOfCall(call: ts.CallExpression): CallResult {
		const given = call.arguments.flatMap(passedChains);
		const builder = this.builderAt(call.expression);
		if (builder === undefined) return { fresh: false, shares: given };
		const read: Chain[] = [];
		const visit = (node: ts.Node): void => {
			if (ts.isIdentifier(node) && this.valueOf(this.followed(this.checker.getSymbolAtLocation(node))) !== undefined)
				read.push({ root: node, accesses: [] });
			ts.forEachChild(node, visit);
		};
		visit(builder.declaration);
		const result = unwrapped(builder.result);
		const fresh = ts.isObjectLiteralExpression(result) || ts.isArrayLiteralExpression(result);
		return { fresh, shares: [...given, ...read] };
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
	 * A project source without syntax errors, the analysed files included: nothing read from a
	 * recovered tree is trusted, wherever it is read from (A36). Declaration files have no values;
	 * an external library's sources are not the project's, and the bundler may resolve another version.
	 */
	private isReadable(file: ts.SourceFile): boolean {
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
