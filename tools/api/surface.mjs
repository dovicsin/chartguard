import { join } from 'node:path';

import ts from 'typescript';

import { publishedPackages } from '../shared/workspace.mjs';

/**
 * The public API surface of a package entry point (CG-00-07): every export, by name, with the
 * declaration text it resolves to (re-exports followed, comments removed). Read from the emitted
 * `.d.ts`, which is what a consumer compiles against.
 */
export function surfaceOf(declarationFile) {
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
	const printer = ts.createPrinter({ removeComments: true });
	const surface = new Map();
	for (const symbol of checker.getExportsOfModule(module)) {
		const target = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
		const text = (target.declarations ?? [])
			.map((declaration) => printer.printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile()))
			.map((printed) => printed.replace(/^(export )?(declare )?/, ''))
			.join('\n');
		surface.set(symbol.name, text);
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
			types: join(path, target.types)
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
	const blocks = entries.map(({ specifier, types }) => {
		const surface = surfaceOf(types);
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
