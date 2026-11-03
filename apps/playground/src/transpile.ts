import ts from 'typescript';

/**
 * The user's source as the drawing frame runs it, on request (CG-06-06 part 4): CommonJS, so its
 * imports become `require` calls the frame answers with the bundled runtimes. Only transpiled here,
 * never evaluated: the page runs no code it was given.
 */
export function transpile(text: string, fileName: string): string {
	return ts.transpileModule(text, {
		fileName,
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
			jsx: ts.JsxEmit.React
		}
	}).outputText;
}
