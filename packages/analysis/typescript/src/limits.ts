import type { Diagnostic } from '@chartguard/core';
import ts from 'typescript';

/** Characters one analysed file may have (about 2 MB); a larger one is not read (CG-03-08). */
export const MAX_SOURCE_LENGTH = 2_000_000;
/**
 * Brackets one file may nest. The TypeScript parser recurses per level and exhausts the stack near
 * a thousand; real chart code stays far below this bound.
 */
export const MAX_NESTING = 256;

const OPENING = new Set([ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenParenToken]);
const CLOSING = new Set([
	ts.SyntaxKind.CloseBraceToken,
	ts.SyntaxKind.CloseBracketToken,
	ts.SyntaxKind.CloseParenToken
]);

/** The deepest bracket nesting, measured with the scanner alone: iterative, so any input is safe to measure. */
function nestingOf(source: string): number {
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
	let depth = 0;
	let deepest = 0;
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if (OPENING.has(token)) deepest = Math.max(deepest, ++depth);
		else if (CLOSING.has(token)) depth = Math.max(0, depth - 1);
	}
	return deepest;
}

const refusal = (code: string, message: string, file: string): Diagnostic => ({
	code,
	severity: 'warning',
	message,
	path: '$',
	confidence: 'unknown',
	file,
	line: 1,
	column: 1
});

/** Why a source is not read at all: too large, or nested deeper than the parser can take. */
export function inputRefusal(source: string, file: string): Diagnostic | undefined {
	if (source.length > MAX_SOURCE_LENGTH)
		return refusal(
			'CFG_TOO_LARGE',
			`The file has ${String(source.length)} characters; at most ${String(MAX_SOURCE_LENGTH)} are read.`,
			file
		);
	const nesting = nestingOf(source);
	if (nesting > MAX_NESTING)
		return refusal(
			'CFG_TOO_COMPLEX',
			`Brackets nest ${String(nesting)} deep; at most ${String(MAX_NESTING)} are read.`,
			file
		);
	return undefined;
}

/**
 * Runs a read of `file`, turning a stack overflow (a file this or an imported one nests too deeply
 * in a way the bracket count does not see, such as JSX) into a refusal instead of a crash.
 */
export function guarded<T>(file: string, read: () => T, refused: (diagnostic: Diagnostic) => T): T {
	try {
		return read();
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return refused(refusal('CFG_TOO_COMPLEX', 'The file, or one it imports, is nested too deeply to read.', file));
	}
}

/** A file-level note: the work bound was reached, so some values were left unknown (`MAX_DECODE_STEPS`). */
export function truncation(file: string): Diagnostic {
	return refusal('CFG_TRUNCATED', 'Reading was stopped at its work limit; some values are left unknown.', file);
}
