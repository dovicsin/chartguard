/** Where a JSON value sits in the text, so a diagnostic path can be highlighted in the editor. */
export interface Span {
	readonly start: number;
	readonly end: number;
}

export type JsonNode =
	| (Span & { readonly kind: 'scalar' })
	| (Span & { readonly kind: 'array'; readonly items: readonly JsonNode[] })
	| (Span & { readonly kind: 'object'; readonly entries: ReadonlyMap<string, JsonNode> });

export type Parsed =
	| { readonly ok: true; readonly root: JsonNode }
	| { readonly ok: false; readonly message: string; readonly offset: number };

class SyntaxProblem extends Error {
	constructor(
		message: string,
		readonly offset: number
	) {
		super(message);
	}
}

const WHITESPACE = /\s/;
const SCALAR = /^(?:"(?:[^"\\\u0000-\u001f]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/** A strict JSON reader that keeps the position of every value; it reports the first syntax error. */
class Reader {
	private offset = 0;

	constructor(private readonly text: string) {}

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
		if (this.peek() !== '}')
			do {
				this.skip();
				const key = this.text.slice(this.offset, this.require(this.scalar(), 'a property name').end);
				this.expect(':');
				entries.set(JSON.parse(key) as string, this.value());
			} while (this.consume(','));
		this.expect('}');
		return { kind: 'object', start, end: this.offset, entries };
	}

	private array(): JsonNode {
		const start = this.offset++;
		const items: JsonNode[] = [];
		if (this.peek() !== ']')
			do items.push(this.value());
			while (this.consume(','));
		this.expect(']');
		return { kind: 'array', start, end: this.offset, items };
	}

	private scalar(): Span & { readonly kind: 'scalar' } {
		const match = SCALAR.exec(this.text.slice(this.offset));
		if (match === null) this.fail('Expected a JSON value');
		const start = this.offset;
		this.offset += match[0].length;
		return { kind: 'scalar', start, end: this.offset };
	}

	private require(span: Span, what: string): Span {
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

export function parseJson(text: string): Parsed {
	try {
		return { ok: true, root: new Reader(text).document() };
	} catch (error) {
		if (error instanceof SyntaxProblem) return { ok: false, message: error.message, offset: error.offset };
		throw error;
	}
}

/**
 * `$.a[0].b["c.d"]` → `['a', 0, 'b', 'c.d']`: identifiers after a dot, indices in brackets (a hole
 * range `[3..9]` becomes its first index), any other key JSON-quoted in brackets.
 */
export function pathSegments(path: string): (string | number)[] {
	const segments: (string | number)[] = [];
	for (const [, key, index, quoted] of path.slice(1).matchAll(/\.([A-Za-z_$][\w$]*)|\[(\d+)(?:\.\.\d+)?\]|\[("(?:[^"\\]|\\.)*")\]/g)) {
		if (index !== undefined) segments.push(Number(index));
		else segments.push(quoted === undefined ? (key ?? '') : (JSON.parse(quoted) as string));
	}
	return segments;
}

function child(node: JsonNode, segment: string | number): JsonNode | undefined {
	if (node.kind === 'array' && typeof segment === 'number') return node.items[segment];
	if (node.kind === 'object' && typeof segment === 'string') return node.entries.get(segment);
	return undefined;
}

/**
 * The span of the value at `path`. A path that does not exist (a missing required key) resolves
 * to its deepest existing ancestor and is marked inexact, so the editor still shows where to look.
 */
export function locate(root: JsonNode, path: string): Span & { readonly exact: boolean } {
	let node = root;
	for (const segment of pathSegments(path)) {
		const next = child(node, segment);
		if (next === undefined) return { start: node.start, end: node.end, exact: false };
		node = next;
	}
	return { start: node.start, end: node.end, exact: true };
}
