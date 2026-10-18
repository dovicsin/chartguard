import { resolve } from 'node:path';

import ts from 'typescript';

const COMPILER_OPTIONS = {
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
	types: []
};

/**
 * Type-checks a generated in-memory entry file against installed declarations.
 * Declarations are only parsed and type-checked; nothing is executed.
 */
export function createEntryProgram(root, entryText) {
	const entryPath = resolve(root, '__chartguard_schema_entry__.ts');
	const host = ts.createCompilerHost(COMPILER_OPTIONS);
	const readSourceFile = host.getSourceFile.bind(host);
	const fileExists = host.fileExists.bind(host);
	host.getSourceFile = (fileName, languageVersion, ...rest) =>
		fileName === entryPath
			? ts.createSourceFile(fileName, entryText, languageVersion, true)
			: readSourceFile(fileName, languageVersion, ...rest);
	host.fileExists = (fileName) => fileName === entryPath || fileExists(fileName);
	const program = ts.createProgram([entryPath], COMPILER_OPTIONS, host);
	const entry = program.getSourceFile(entryPath);
	return { program, checker: program.getTypeChecker(), entry };
}

/** The type named by each `export type Name = ...` alias in the entry file. */
export function exportedAliasTypes(checker, entry) {
	return new Map(
		entry.statements
			.filter((statement) => ts.isTypeAliasDeclaration(statement))
			.map((statement) => [statement.name.text, checker.getTypeAtLocation(statement.name)])
	);
}
