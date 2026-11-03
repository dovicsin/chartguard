import { pathSegments } from './paths.js';

/**
 * A JSON text read with the position of every value (CG-06-02), so a finding's path can be shown
 * where it is: in an editor (the playground) or in a SARIF log (the CLI). Exactly `JSON.parse`'s
 * grammar; positions are offsets and 1-based lines and columns (UTF-16 code units, as editors count).
 */
export interface JsonSpan {
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly column: number;
	readonly endLine: number;
	readonly endColumn: number;
}

export type JsonNode =
	| (JsonSpan & { readonly kind: 'scalar' })
	| (JsonSpan & { readonly kind: 'array'; readonly items: readonly JsonNode[] })
	| (JsonSpan & { readonly kind: 'object'; readonly entries: ReadonlyMap<string, JsonNode> });

/** The key tokens of each object `parseJsonSource` read, by key: what `locateJsonKey` answers from. */
const KEYS = new WeakMap<JsonNode, ReadonlyMap<string, JsonSpan>>();

export type JsonSource =
	| { readonly ok: true; readonly root: JsonNode }
	| {
			readonly ok: false;
			readonly message: string;
			readonly offset: number;
			readonly line: number;
			readonly column: number;
	  };

/** The 1-based line and column of each offset of a text. */
class Lines {
	private readonly starts: number[] = [0];

	constructor(text: string) {
		for (let index = 0; index < text.length; index++) if (text[index] === '\n') this.starts.push(index + 1);
	}

	at(offset: number): { readonly line: number; readonly column: number } {
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if ((this.starts[middle] ?? 0) <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low + 1, column: offset - (this.starts[low] ?? 0) + 1 };
	}

	span(start: number, end: number): JsonSpan {
		const from = this.at(start);
		const to = this.at(end);
		return { start, end, line: from.line, column: from.column, endLine: to.line, endColumn: to.column };
	}
}

class SyntaxProblem extends Error {
	constructor(
		message: string,
		readonly offset: number
	) {
		super(message);
	}
}

/** JSON whitespace: space, tab, line feed and carriage return only, not every Unicode space (H13). */
const WHITESPACE = /[ \t\n\r]/;
/** A string with only the escapes JSON knows, a number, `true`, `false` or `null`. */
const SCALAR =
	/^(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/** A strict JSON reader that keeps the position of every value; it reports the first syntax error. */
class Reader {
	private offset = 0;

	constructor(
		private readonly text: string,
		private readonly lines: Lines
	) {}

	document(): JsonNode {
		const root = this.value();
		this.skip();
		if (this.offset < this.text.length) this.fail('Unexpected text after the JSON value');
		return root;
	}

	private value(): JsonNode {
		this.skip();
		const next = this.text[this.offset];
		if (next === '{') return this.object();
		if (next === '[') return this.array();
		return this.scalar();
	}

	private object(): JsonNode {
		const start = this.offset++;
		const entries = new Map<string, JsonNode>();
		const keys = new Map<string, JsonSpan>();
		if (this.peek() !== '}')
			do {
				this.skip();
				const { kind: _kind, ...token } = this.require(this.scalar(), 'a property name');
				const key = JSON.parse(this.text.slice(token.start, token.end)) as string;
				this.expect(':');
				entries.set(key, this.value());
				keys.set(key, token);
			} while (this.consume(','));
		this.expect('}');
		const node: JsonNode = { kind: 'object', ...this.lines.span(start, this.offset), entries };
		KEYS.set(node, keys);
		return node;
	}

	private array(): JsonNode {
		const start = this.offset++;
		const items: JsonNode[] = [];
		if (this.peek() !== ']')
			do items.push(this.value());
			while (this.consume(','));
		this.expect(']');
		return { kind: 'array', ...this.lines.span(start, this.offset), items };
	}

	private scalar(): JsonSpan & { readonly kind: 'scalar' } {
		const match = SCALAR.exec(this.text.slice(this.offset));
		if (match === null) this.fail('Expected a JSON value');
		const start = this.offset;
		this.offset += match[0].length;
		return { kind: 'scalar', ...this.lines.span(start, this.offset) };
	}

	private require<T extends JsonSpan>(span: T, what: string): T {
		if (this.text[span.start] !== '"') throw new SyntaxProblem(`Expected ${what} in double quotes`, span.start);
		return span;
	}

	private peek(): string | undefined {
		this.skip();
		return this.text[this.offset];
	}

	private consume(token: string): boolean {
		if (this.peek() !== token) return false;
		this.offset++;
		return true;
	}

	private expect(token: string): void {
		if (!this.consume(token)) this.fail(`Expected "${token}"`);
	}

	private skip(): void {
		while (this.offset < this.text.length && WHITESPACE.test(this.text.charAt(this.offset))) this.offset++;
	}

	private fail(message: string): never {
		throw new SyntaxProblem(message, this.offset);
	}
}

/** The JSON text with the position of every value, or its first syntax error and where. Never throws. */
export function parseJsonSource(text: string): JsonSource {
	const lines = new Lines(text);
	try {
		return { ok: true, root: new Reader(text, lines).document() };
	} catch (error) {
		if (!(error instanceof SyntaxProblem)) throw error;
		return { ok: false, message: error.message, offset: error.offset, ...lines.at(error.offset) };
	}
}

function child(node: JsonNode, segment: string | number): JsonNode | undefined {
	if (node.kind === 'array' && typeof segment === 'number') return node.items[segment];
	if (node.kind === 'object' && typeof segment === 'string') return node.entries.get(segment);
	return undefined;
}

/** A run of holes (`[3..9]`, one finding for a sparse list) is read as its first index. */
const HOLE_RUN = /\[(\d+)\.\.\d+\]/gu;

/**
 * Where the value at a finding's `path` is. A path that does not exist (a missing required key)
 * resolves to its deepest existing ancestor and is marked inexact; a path that is not one the
 * engine writes is the root, inexact.
 */
export function locateJsonPath(root: JsonNode, path: string): JsonSpan & { readonly exact: boolean } {
	const segments = pathSegments(path.replace(HOLE_RUN, '[$1]'));
	const span = (node: JsonNode): JsonSpan => ({
		start: node.start,
		end: node.end,
		line: node.line,
		column: node.column,
		endLine: node.endLine,
		endColumn: node.endColumn
	});
	if (segments === undefined) return { ...span(root), exact: false };
	let node = root;
	for (const segment of segments) {
		const next = child(node, segment);
		if (next === undefined) return { ...span(node), exact: false };
		node = next;
	}
	return { ...span(node), exact: true };
}

/**
 * Where the key token of `key` in an object `parseJsonSource` read is (quotes included), so an
 * editor can rename it (CG-06-06); for a duplicate key the last, whose value `JSON.parse` keeps.
 * Undefined when the object has no such key, or the node was not read by `parseJsonSource`.
 */
export function locateJsonKey(object: JsonNode, key: string): JsonSpan | undefined {
	return KEYS.get(object)?.get(key);
}
