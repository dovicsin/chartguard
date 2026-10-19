import ts from 'typescript';

const PACKAGE_PATH = /^.*\/node_modules\//;

/** `chart.js/dist/types/index.d.ts` for a file under node_modules, else undefined. */
function packageRelative(fileName) {
	return PACKAGE_PATH.test(fileName) ? fileName.replace(PACKAGE_PATH, '') : undefined;
}

/**
 * Which published declaration a fact cites, and how that becomes a provenance record.
 * Pointers are package-relative (`chart.js/dist/types/index.d.ts:12`); local paths never leak.
 * Only declarations inside the pinned package count: TypeScript's own lib (`Pick`, `Partial`)
 * and other installed packages are not evidence for the pinned source.
 */
export class Provenance {
	constructor(checker, { sourceId, packageName }) {
		this.checker = checker;
		this.sourceId = sourceId;
		this.prefix = `${packageName}/`;
	}

	/** The pinned-package-relative path of a symbol's declaration, if it is declared there. */
	pinnedPath(symbol) {
		const fileName = symbol?.declarations?.[0]?.getSourceFile().fileName;
		const relative = fileName === undefined ? undefined : packageRelative(fileName);
		return relative?.startsWith(this.prefix) === true ? relative : undefined;
	}

	isPublished = (symbol) => this.pinnedPath(symbol) !== undefined;

	/**
	 * The published symbol an object type should cite: its alias when published, else its own
	 * symbol, else what it is composed from, else the published type its (generator-local) alias names.
	 */
	ownerOf(type) {
		if (this.isPublished(type.aliasSymbol)) return type.aliasSymbol;
		const own = type.getSymbol();
		if (this.isPublished(own)) return own;
		return this.ownerOfComposite(type) ?? this.aliasTarget(type) ?? own;
	}

	/**
	 * `A & { … }` cites its first published member; a lib mapped type over a package type
	 * (`Pick<LabelOption, …>`, `Omit<…>`) cites that type. Each property still cites its own declaration.
	 */
	ownerOfComposite(type) {
		const parts = type.isIntersection() ? type.types : (type.aliasTypeArguments ?? []).slice(0, 1);
		return parts.map((part) => this.ownerOf(part)).find(this.isPublished);
	}

	/** `export type Dataset_bar = ChartDataset<'bar'>` in the entry file names `ChartDataset`. */
	aliasTarget(type) {
		const declaration = type.aliasSymbol?.declarations?.[0];
		if (
			declaration === undefined ||
			!ts.isTypeAliasDeclaration(declaration) ||
			!ts.isTypeReferenceNode(declaration.type)
		)
			return undefined;
		const referenced = this.checker.getSymbolAtLocation(declaration.type.typeName);
		if (referenced === undefined) return undefined;
		// An `import type { X }` binding is itself an alias symbol; follow it to the declaration.
		return (referenced.flags & ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(referenced) : referenced;
	}

	/** A fact without a declaration in the pinned package cannot claim authority: it is `derived`. */
	of(symbol) {
		const path = this.pinnedPath(symbol);
		if (path === undefined) return { confidence: 'derived', sources: [{ source: this.sourceId }] };
		const declaration = symbol.declarations[0];
		const file = declaration.getSourceFile();
		const { line } = file.getLineAndCharacterOfPosition(declaration.getStart(file));
		return {
			confidence: 'authoritative',
			sources: [{ source: this.sourceId, pointer: `${path}:${String(line + 1)}` }]
		};
	}
}
