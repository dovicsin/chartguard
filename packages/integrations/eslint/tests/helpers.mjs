import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

/** RuleTester with the default parser (JavaScript modules) and one with typescript-eslint for TS and TSX. */
export const javascript = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
export const typescript = new RuleTester({
	languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } }
});

/**
 * Where `snippet` stands in `code` (its `occurrence`-th appearance, on one line), as ESLint reports it:
 * 1-based lines and columns, the end exclusive. Line breaks as ESLint and TypeScript count them.
 */
export function at(code, snippet, occurrence = 1) {
	let offset = -1;
	for (let found = 0; found < occurrence; found++) offset = code.indexOf(snippet, offset + 1);
	if (offset === -1) throw new Error(`${snippet} not in the code`);
	const before = code.slice(0, offset).split(/\r\n|[\r\n\u2028\u2029]/u);
	const line = before.length;
	const column = (before.at(-1)?.length ?? 0) + 1;
	return { line, column, endLine: line, endColumn: column + snippet.length };
}

/** One expected report: its message and where it stands. */
export const finding = (message, place) => ({ message, ...place });
