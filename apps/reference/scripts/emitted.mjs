import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

import { manifestsUnder } from '../../../tools/shared/workspace.mjs';

/** A diagnostic code, exactly: `CFG_TYPE`, `VIS_BAR_BASELINE`. */
const CODE = /^(?:CFG|VIS|AST)_[A-Z]+(?:_[A-Z]+)*$/u;

function sourcesUnder(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourcesUnder(path);
		return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
	});
}

/** The codes one source file writes as string literals (on the syntax tree: a comment that names one is none). */
function codesIn(file) {
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const found = new Set();
	const visit = (node) => {
		if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && CODE.test(node.text))
			found.add(node.text);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/**
 * Every code the packages' sources emit, with the packages that write it, in code-point order of
 * both: what the codes page documents, read where the codes are written, never kept by hand.
 */
export function emittedCodes(root) {
	const byCode = new Map();
	for (const { path, manifest } of manifestsUnder(join(root, 'packages'))) {
		const src = join(path, 'src');
		if (!readdirSync(path).includes('src')) continue;
		for (const file of sourcesUnder(src))
			for (const code of codesIn(file)) byCode.set(code, new Set([...(byCode.get(code) ?? []), manifest.name]));
	}
	const order = (a, b) => (a < b ? -1 : Number(a > b));
	return new Map([...byCode].sort(([a], [b]) => order(a, b)).map(([code, names]) => [code, [...names].sort(order)]));
}
