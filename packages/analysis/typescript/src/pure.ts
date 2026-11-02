import ts from 'typescript';

import { type Call, topLevelNames } from './writes.js';

/** Globals that read what they are given and never change it. */
const PURE_MEMBERS: ReadonlyMap<string, ReadonlySet<string> | 'any'> = new Map<string, ReadonlySet<string> | 'any'>([
	['console', 'any'],
	['JSON', new Set(['stringify'])],
	['Object', new Set(['keys', 'values', 'entries', 'getOwnPropertyNames', 'hasOwn', 'isFrozen', 'freeze'])],
	['Array', new Set(['isArray', 'from'])]
]);
const PURE_FUNCTIONS: ReadonlySet<string> = new Set(['structuredClone', 'String', 'Number', 'Boolean']);

/**
 * Whether `name` is the global it spells: the checker's symbol is the global of that name and is
 * declared only in declaration files (the default lib, `@types/node`), which run nothing; or nothing
 * declares it (a Program without lib). A local `console`, or a script's own global, may do anything.
 */
function isGlobal(name: ts.Identifier, program: ts.Program): boolean {
	const checker = program.getTypeChecker();
	const symbol = checker.getSymbolAtLocation(name);
	const declarations = symbol?.declarations ?? [];
	if (scriptNames(program).has(name.text)) return false;
	if (symbol === undefined || declarations.length === 0) return true;
	const global = checker.resolveName(name.text, undefined, ts.SymbolFlags.Value, false);
	return global === symbol && declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
}

const SCRIPT_NAMES = new WeakMap<ts.Program, ReadonlySet<string>>();

/**
 * The names a script (a source file that is not a module) declares at its top level: they shadow
 * the global of that name in every script at runtime, although the checker merges them into it.
 */
function scriptNames(program: ts.Program): ReadonlySet<string> {
	const known = SCRIPT_NAMES.get(program);
	if (known !== undefined) return known;
	const names = new Set(
		program
			.getSourceFiles()
			.filter((file) => !file.isDeclarationFile && !ts.isExternalModule(file))
			.flatMap((file) => topLevelNames(file).map((name) => name.text))
	);
	SCRIPT_NAMES.set(program, names);
	return names;
}

/** A call to one of those globals, resolved by its declaration (A38), never by its name alone. */
export function isPureCall(call: Call, program: ts.Program): boolean {
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return PURE_FUNCTIONS.has(callee.text) && isGlobal(callee, program);
	if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
	const members = PURE_MEMBERS.get(callee.expression.text);
	const pure = members === 'any' || members?.has(callee.name.text) === true;
	return pure && isGlobal(callee.expression, program);
}
