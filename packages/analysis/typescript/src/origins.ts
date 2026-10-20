import ts from 'typescript';

import { bindingOf } from './scope.js';

/**
 * Where a callee or JSX tag comes from: a package (`chart.js`) or a project file, and the path of
 * names inside it (`['default', 'chart']` for `Highcharts.chart` of a default import).
 */
export interface Origin {
	readonly package?: string;
	readonly file?: string;
	readonly path: readonly string[];
}

const MAX_HOPS = 16;

/** `@scope/name/sub` → `@scope/name`; `chart.js/auto` → `chart.js`. Bare specifiers only. */
export function packageOf(specifier: string): string {
	const segments = specifier.split('/');
	return (specifier.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1)).join('/');
}

const isBare = (specifier: string): boolean => !specifier.startsWith('.') && !specifier.startsWith('/');

/** The package of a file installed under `node_modules`, read from its path segments. */
function installedPackage(fileName: string): string | undefined {
	const segments = fileName.split(/[\\/]/);
	const at = segments.lastIndexOf('node_modules');
	if (at < 0) return undefined;
	const [first, second] = segments.slice(at + 1);
	if (first === undefined) return undefined;
	return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first;
}

function specifierOf(node: ts.Node): string | undefined {
	const declaration = ts.findAncestor(
		node,
		(ancestor) => ts.isImportDeclaration(ancestor) || ts.isExportDeclaration(ancestor)
	);
	if (declaration === undefined || !(ts.isImportDeclaration(declaration) || ts.isExportDeclaration(declaration)))
		return undefined;
	const specifier = declaration.moduleSpecifier;
	return specifier !== undefined && ts.isStringLiteral(specifier) ? specifier.text : undefined;
}

/** The names an import or re-export declaration binds inside its module. */
function importedPath(declaration: ts.Node): string[] | undefined {
	if (ts.isImportSpecifier(declaration) || ts.isExportSpecifier(declaration))
		return [(declaration.propertyName ?? declaration.name).text];
	if (ts.isImportClause(declaration)) return ['default'];
	if (ts.isNamespaceImport(declaration)) return [];
	return undefined;
}

/** `require('m')`, the only call whose result is known without running it. */
function requiredModule(node: ts.Expression | undefined): string | undefined {
	if (node === undefined || !ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
	const [argument] = node.arguments;
	return node.expression.text === 'require' && argument !== undefined && ts.isStringLiteral(argument)
		? argument.text
		: undefined;
}

/** Traces callees and tags to their origin through imports, `require`, re-exports and `const` aliases; reads only. */
export class Origins {
	private readonly checker: ts.TypeChecker;

	constructor(private readonly program: ts.Program) {
		this.checker = program.getTypeChecker();
	}

	of(node: ts.Expression | ts.JsxTagNameExpression, hops = 0): Origin | undefined {
		if (hops > MAX_HOPS) return undefined;
		if (ts.isIdentifier(node)) return this.ofSymbol(this.checker.getSymbolAtLocation(node), hops + 1);
		if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.name)) return undefined;
		// Resolved through the checker when the module is loaded; otherwise read from the syntax.
		const member = this.ofSymbol(this.checker.getSymbolAtLocation(node.name), hops + 1);
		if (member !== undefined) return member;
		const base = this.of(node.expression, hops + 1);
		return base === undefined ? undefined : { ...base, path: [...base.path, node.name.text] };
	}

	private ofSymbol(symbol: ts.Symbol | undefined, hops: number): Origin | undefined {
		const declaration = symbol?.declarations?.[0];
		if (symbol === undefined || declaration === undefined || hops > MAX_HOPS) return undefined;
		const path = importedPath(declaration);
		if (path !== undefined) return this.ofImport(symbol, declaration, path, hops);
		if ((symbol.flags & ts.SymbolFlags.Alias) !== 0)
			return this.ofSymbol(this.checker.getImmediateAliasedSymbol(symbol), hops + 1);
		return this.ofDeclaration(declaration, symbol, hops);
	}

	/** A package import ends here; a project file's import or re-export is followed to what it names. */
	private ofImport(symbol: ts.Symbol, declaration: ts.Declaration, path: string[], hops: number): Origin | undefined {
		const specifier = specifierOf(declaration);
		if (specifier !== undefined && isBare(specifier)) return { package: packageOf(specifier), path };
		return this.ofSymbol(this.checker.getImmediateAliasedSymbol(symbol), hops + 1);
	}

	private ofDeclaration(declaration: ts.Declaration, symbol: ts.Symbol, hops: number): Origin | undefined {
		if (ts.isSourceFile(declaration)) return { file: declaration.fileName, path: [] };
		if (ts.isBindingElement(declaration)) return this.ofBinding(declaration);
		if (ts.isVariableDeclaration(declaration)) {
			const origin = this.ofVariable(declaration, hops);
			if (origin !== 'declared') return origin;
		}
		const file = declaration.getSourceFile();
		const installed = installedPackage(file.fileName);
		if (installed !== undefined && this.program.isSourceFileFromExternalLibrary(file))
			return { package: installed, path: [symbol.name] };
		return { file: file.fileName, path: [symbol.name] };
	}

	/** `const x = require('m')`, or `const C = Chart` (an alias that cannot be reassigned); otherwise its own declaration. */
	private ofVariable(declaration: ts.VariableDeclaration, hops: number): Origin | undefined | 'declared' {
		const { initializer } = declaration;
		const required = requiredModule(initializer);
		if (required !== undefined) return isBare(required) ? { package: packageOf(required), path: [] } : undefined;
		if (bindingOf(declaration) === 'const' && initializer !== undefined && this.isAliasExpression(initializer))
			return this.of(initializer, hops + 1);
		return 'declared';
	}

	/** `const { Chart } = require('chart.js')`. */
	private ofBinding(element: ts.BindingElement): Origin | undefined {
		const declaration = element.parent.parent;
		if (!ts.isVariableDeclaration(declaration) || !ts.isObjectBindingPattern(element.parent)) return undefined;
		const required = requiredModule(declaration.initializer);
		const name = element.propertyName ?? element.name;
		if (required === undefined || !isBare(required) || !ts.isIdentifier(name)) return undefined;
		return { package: packageOf(required), path: [name.text] };
	}

	private isAliasExpression(node: ts.Expression): node is ts.Identifier | ts.PropertyAccessExpression {
		return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node);
	}
}
