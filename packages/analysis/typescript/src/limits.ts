import type { Diagnostic } from '@chartguard/core';
import ts from 'typescript';

/** Characters one analysed file may have (about 2 MB); a larger one is not read (CG-03-08). */
export const MAX_SOURCE_LENGTH = 2_000_000;
/**
 * Brackets one file may nest. The TypeScript parser recurses per level and exhausts the stack near
 * a thousand; real chart code stays far below this bound.
 */
export const MAX_NESTING = 256;

const OPENING = new Set([ts.SyntaxKind.OpenBracketToken, ts.SyntaxKind.OpenParenToken]);
const CLOSING = new Set([ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseParenToken]);

/** Tokens after which a `/` divides; after any other a regular expression starts. */
const ENDS_OPERAND = new Set([
	ts.SyntaxKind.Identifier,
	ts.SyntaxKind.PrivateIdentifier,
	ts.SyntaxKind.NumericLiteral,
	ts.SyntaxKind.BigIntLiteral,
	ts.SyntaxKind.StringLiteral,
	ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateTail,
	ts.SyntaxKind.RegularExpressionLiteral,
	ts.SyntaxKind.CloseParenToken,
	ts.SyntaxKind.CloseBracketToken,
	ts.SyntaxKind.CloseBraceToken,
	ts.SyntaxKind.PlusPlusToken,
	ts.SyntaxKind.MinusMinusToken,
	ts.SyntaxKind.ThisKeyword,
	ts.SyntaxKind.SuperKeyword,
	ts.SyntaxKind.TrueKeyword,
	ts.SyntaxKind.FalseKeyword,
	ts.SyntaxKind.NullKeyword
]);

const SLASHES = new Set([ts.SyntaxKind.SlashToken, ts.SyntaxKind.SlashEqualsToken]);

/**
 * Bracket depth as the scanner sees it, template- and regex-aware: a `}` that closes a template
 * substitution resumes the template's text (`reScanTemplateToken`), and a `/` where an operand may
 * start is a regular expression (`reScanSlashToken`), so brackets in either are text.
 */
class Nesting {
	depth = 0;
	deepest = 0;
	/** For each open `{` or `${`, whether it is a template substitution. */
	private readonly braces: boolean[] = [];

	constructor(private readonly scanner: ts.Scanner) {}

	/** The token, rescanned where the previous one decides what it is. */
	next(previous: ts.SyntaxKind): ts.SyntaxKind {
		const token = this.scanner.scan();
		if (SLASHES.has(token) && !ENDS_OPERAND.has(previous)) return this.scanner.reScanSlashToken();
		if (token === ts.SyntaxKind.CloseBraceToken && this.braces.at(-1) === true)
			return this.scanner.reScanTemplateToken(false);
		return token;
	}

	count(token: ts.SyntaxKind): void {
		if (OPENING.has(token) || token === ts.SyntaxKind.OpenBraceToken || token === ts.SyntaxKind.TemplateHead)
			this.open(token);
		else if (CLOSING.has(token)) this.depth = Math.max(0, this.depth - 1);
		else if (token === ts.SyntaxKind.CloseBraceToken || token === ts.SyntaxKind.TemplateTail) this.closeBrace();
	}

	private open(token: ts.SyntaxKind): void {
		this.deepest = Math.max(this.deepest, ++this.depth);
		if (token === ts.SyntaxKind.OpenBraceToken) this.braces.push(false);
		else if (token === ts.SyntaxKind.TemplateHead) this.braces.push(true);
	}

	/** A `}` or the end of a template: the innermost brace closes. A `TemplateMiddle` keeps it open. */
	private closeBrace(): void {
		this.braces.pop();
		this.depth = Math.max(0, this.depth - 1);
	}
}

/** The deepest bracket nesting, measured with the scanner alone: iterative, so any input is safe to measure. */
function nestingOf(source: string): number {
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
	const nesting = new Nesting(scanner);
	let previous = ts.SyntaxKind.Unknown;
	for (let token = nesting.next(previous); token !== ts.SyntaxKind.EndOfFileToken; token = nesting.next(previous)) {
		nesting.count(token);
		previous = token;
	}
	return nesting.deepest;
}

/** A file-level note on why `file` is not read, or only in part. */
export const refusal = (code: string, message: string, file: string): Diagnostic => ({
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
		return refused(tooDeep(file));
	}
}

/** The refusal of a file whose reading overflowed the stack: it, or one it imports, nests too deeply. */
export function tooDeep(file: string): Diagnostic {
	return refusal('CFG_TOO_COMPLEX', 'The file, or one it imports, is nested too deeply to read.', file);
}

/** A file-level note: the work bound was reached, so some values were left unknown (`MAX_DECODE_STEPS`). */
export function truncation(file: string): Diagnostic {
	return refusal('CFG_TRUNCATED', 'Reading was stopped at its work limit; some values are left unknown.', file);
}
