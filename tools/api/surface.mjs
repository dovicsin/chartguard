import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import ts from 'typescript';

import { publishedPackages } from '../shared/workspace.mjs';

const printer = ts.createPrinter({ removeComments: true });

/** A declaration as a consumer reads it: comments removed, without `export`/`declare`. */
const printed = (declaration) =>
	printer
		.printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile())
		.replace(/^(export )?(declare )?/, '');

const resolved = (checker, symbol) =>
	symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;

/** The name a type reference, `typeof` query, heritage clause or `import("…").X` names. */
function referenceName(node) {
	if (ts.isTypeReferenceNode(node)) return node.typeName;
	if (ts.isExpressionWithTypeArguments(node)) return node.expression;
	if (ts.isTypeQueryNode(node)) return node.exprName;
	return ts.isImportTypeNode(node) ? node.qualifier : undefined;
}

function referencesIn(declaration, checker) {
	const symbols = [];
	const visit = (node) => {
		const name = referenceName(node);
		if (name !== undefined) symbols.push(resolved(checker, checker.getSymbolAtLocation(name)));
		ts.forEachChild(node, visit);
	};
	visit(declaration);
	return symbols.filter((symbol) => symbol !== undefined && (symbol.flags & ts.SymbolFlags.TypeParameter) === 0);
}

/**
 * The declarations `declarations` reference, transitively, that the entry point does not export
 * but this package declares: their shape is part of the export's, so a change inside one changes
 * the export. Other packages' types are on their own surfaces; the platform's are not ours.
 */
function internalsOf(declarations, { checker, exported, inPackage }) {
	const found = new Map();
	const queue = [...declarations];
	while (queue.length > 0) {
		for (const symbol of referencesIn(queue.pop(), checker)) {
			if (exported.has(symbol) || found.has(symbol)) continue;
			const own = (symbol.declarations ?? []).filter((declaration) => inPackage(declaration.getSourceFile()));
			if (own.length === 0) continue;
			found.set(symbol, own);
			queue.push(...own);
		}
	}
	return [...found].map(([symbol, own]) => `// uses ${symbol.name}\n${own.map(printed).join('\n')}`).sort(byCodePoint);
}

/**
 * The public API surface of a package entry point (CG-00-07): every export, by name, with the
 * declaration text it resolves to (re-exports followed, comments removed), followed by every
 * non-exported declaration of the package it references (`// uses Name`). Read from the emitted
 * `.d.ts`, which is what a consumer compiles against. `packageDir` bounds "of the package"
 * (default: the declaration file's directory).
 */
export function surfaceOf(declarationFile, packageDir = dirname(declarationFile)) {
	const program = ts.createProgram([declarationFile], {
		noEmit: true,
		noLib: true,
		types: [],
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		target: ts.ScriptTarget.ES2022
	});
	const checker = program.getTypeChecker();
	const file = program.getSourceFile(declarationFile);
	const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
	if (module === undefined) throw new Error(`Not a module: ${declarationFile}`);
	const exports = checker.getExportsOfModule(module).map((symbol) => [symbol.name, resolved(checker, symbol)]);
	const root = realpathSync(packageDir);
	const inPackage = (source) => {
		const path = relative(root, realpathSync(source.fileName));
		return path !== '' && !isAbsolute(path) && path.split(sep)[0] !== '..';
	};
	const context = { checker, exported: new Set(exports.map(([, target]) => target)), inPackage };
	const surface = new Map();
	for (const [name, target] of exports) {
		const declarations = target.declarations ?? [];
		surface.set(name, [...declarations.map(printed), ...internalsOf(declarations, context)].join('\n'));
	}
	return surface;
}

/** Code-point order, never the locale's (D13). */
const byCodePoint = (a, b) => (a < b ? -1 : Number(a > b));

/** A package's entry points with the declaration file each exports its types from. */
function entriesOf({ path, manifest }) {
	return Object.entries(typeof manifest.exports === 'object' ? manifest.exports : {})
		.filter(([, target]) => typeof target === 'object' && typeof target.types === 'string')
		.map(([key, target]) => ({
			packageName: manifest.name,
			specifier: key === '.' ? manifest.name : `${manifest.name}${key.slice(1)}`,
			types: join(path, target.types),
			packageDir: path
		}));
}

/** Every published package's entry points, in code-point order of their specifiers. */
export function publishedEntryPoints(root) {
	return publishedPackages(root)
		.flatMap(entriesOf)
		.sort((a, b) => byCodePoint(a.specifier, b.specifier));
}

/** A package's surface file: each entry point, then each export with its declaration, in code-point order. */
export function surfaceText(entries) {
	const blocks = entries.map(({ specifier, types, packageDir }) => {
		const surface = surfaceOf(types, packageDir);
		const exports = [...surface.keys()].sort(byCodePoint).map((name) => `### ${name}\n${surface.get(name)}`);
		return [`## ${specifier}`, ...exports].join('\n\n');
	});
	return `${blocks.join('\n\n')}\n`;
}

/** `## entry` → `### export` → declaration text. */
export function parseSurface(text) {
	const exports = new Map();
	let entry = '';
	for (const block of text.split(/\n(?=## |### )/)) {
		if (block.startsWith('## ')) entry = block.slice(3).trim();
		else if (block.startsWith('### ')) {
			const newline = block.indexOf('\n');
			const name = newline < 0 ? block.slice(4) : block.slice(4, newline);
			exports.set(`${entry} ${name}`, newline < 0 ? '' : block.slice(newline + 1).trim());
		}
	}
	return exports;
}

/**
 * How the current surface differs from the recorded one: a removed or changed export is breaking
 * (a major version), an added one additive (a minor version).
 */
export function compareSurfaces(recorded, current) {
	const breaking = [];
	const additive = [];
	for (const [name, text] of recorded) {
		if (!current.has(name)) breaking.push(`removed ${name}`);
		else if (current.get(name) !== text) breaking.push(`changed ${name}`);
	}
	for (const name of current.keys()) if (!recorded.has(name)) additive.push(`added ${name}`);
	return { breaking, additive };
}
