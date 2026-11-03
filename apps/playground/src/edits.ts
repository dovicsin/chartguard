import {
	applyFix,
	type Diagnostic,
	FixError,
	type JsonNode,
	locateJsonKey,
	type OptionEdit,
	pathSegments
} from '@chartguard/core';

/** A replacement of `text[start, end)`: one per fix, so the user's formatting elsewhere stays as typed. */
export interface TextEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** The parsed editor text a fix is made against. */
export interface Parsed {
	readonly text: string;
	readonly tree: JsonNode;
	readonly config: unknown;
}

type Segment = string | number;

function child(node: JsonNode, segment: Segment): JsonNode | undefined {
	if (node.kind === 'object' && typeof segment === 'string') return node.entries.get(segment);
	return node.kind === 'array' && typeof segment === 'number' ? node.items[segment] : undefined;
}

/** The node at `segments`, and how many of them it took to reach it (fewer: the rest is missing). */
function walk(tree: JsonNode, segments: readonly Segment[]): { readonly node: JsonNode; readonly depth: number } {
	let node = tree;
	for (const [depth, segment] of segments.entries()) {
		const next = child(node, segment);
		if (next === undefined) return { node, depth };
		node = next;
	}
	return { node, depth: segments.length };
}

/**
 * The key token the finding's path ends in, replaced by the new name. Where it is not that key (a
 * missing parent), the verification in `fixEdit` refuses the edit.
 */
function renameEdit(tree: JsonNode, path: string, to: string): TextEdit | undefined {
	const segments = pathSegments(path);
	const key = segments?.at(-1);
	if (segments === undefined || key === undefined) return undefined;
	const { node } = walk(tree, segments.slice(0, -1));
	const token = locateJsonKey(node, String(key));
	return token === undefined ? undefined : { start: token.start, end: token.end, text: JSON.stringify(to) };
}

/** The indentation of the line `offset` is on, when only whitespace precedes it there. */
function indentationAt(text: string, offset: number): string | undefined {
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const before = text.slice(lineStart, offset);
	return /^[ \t]*$/u.test(before) ? before : undefined;
}

/** `"key": value` added to an object: after its last entry, on that entry's line indentation, or inside `{}`. */
function insertion(text: string, object: Extract<JsonNode, { kind: 'object' }>, entry: string): TextEdit {
	const last = [...object.entries].reduce<[string, JsonNode] | undefined>(
		(found, candidate) => (found === undefined || candidate[1].end > found[1].end ? candidate : found),
		undefined
	);
	if (last === undefined) return { start: object.start + 1, end: object.start + 1, text: entry };
	const { end } = last[1];
	// A key alone on its line is on a line of its own after `{`: the entry goes on a new line like it.
	const token = locateJsonKey(object, last[0]);
	const indentation = token === undefined ? undefined : indentationAt(text, token.start);
	const separator = indentation === undefined ? ', ' : `,\n${indentation}`;
	return { start: end, end, text: `${separator}${entry}` };
}

/** The value at the edit's path replaced, or the missing keys on the way inserted into the deepest object. */
function optionEdit(text: string, tree: JsonNode, { path, value }: OptionEdit): TextEdit | undefined {
	const segments = pathSegments(path);
	if (segments === undefined) return undefined;
	const { node, depth } = walk(tree, segments);
	if (depth === segments.length) return { start: node.start, end: node.end, text: JSON.stringify(value) };
	const [first, ...rest] = segments.slice(depth).map(String);
	if (node.kind !== 'object' || first === undefined) return undefined;
	// A computed key defines an own property, `__proto__` included; JSON.stringify writes it as a key.
	const nested = rest.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value);
	return insertion(text, node, `${JSON.stringify(first)}: ${JSON.stringify(nested)}`);
}

/** A JSON value's text with every object's keys in code-unit order (keys are unique): equal texts, equal values. */
const canonical = (value: unknown): string =>
	JSON.stringify(value, (_key, inner: unknown) =>
		inner !== null && typeof inner === 'object' && !Array.isArray(inner)
			? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => (left < right ? -1 : 1)))
			: inner
	);

export const applyEdit = (text: string, edit: TextEdit): string =>
	`${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;

/**
 * The text edit that applies the finding's fix, or `undefined` when there is none or it cannot be
 * verified: `applyFix` must accept the fix on the parsed config (it still holds), and the edited text
 * must parse to exactly what `applyFix` returns (a duplicate key, for one, would not).
 */
export function fixEdit(parsed: Parsed, diagnostic: Diagnostic): TextEdit | undefined {
	const { fix } = diagnostic;
	if (fix === undefined) return undefined;
	let expected: unknown;
	try {
		expected = applyFix(parsed.config, fix, diagnostic.path);
	} catch (error) {
		if (error instanceof FixError) return undefined;
		throw error;
	}
	const edit =
		fix.kind === 'rename-key'
			? renameEdit(parsed.tree, diagnostic.path, fix.to)
			: optionEdit(parsed.text, parsed.tree, fix);
	if (edit === undefined) return undefined;
	let actual: unknown;
	try {
		actual = JSON.parse(applyEdit(parsed.text, edit));
	} catch {
		// Not reached by the edits above (their tokens are JSON.stringify's, at places JSON allows
		// them); kept so that a text that does not parse is never offered.
		return undefined;
	}
	return canonical(actual) === canonical(expected) ? edit : undefined;
}

/** A fix the page can offer: how its button reads, what it changes when it changes the drawing, the edit. */
export interface Offer {
	readonly label: string;
	readonly note?: string;
	readonly edit: TextEdit;
}

/**
 * The offer for a finding, when its fix verifies. A rename keeps what the runtime does; a drawing
 * change says so on its button and names its effect, so applying it is the user's decision.
 */
export function offerOf(parsed: Parsed, diagnostic: Diagnostic): Offer | undefined {
	const { fix } = diagnostic;
	const edit = fixEdit(parsed, diagnostic);
	if (fix === undefined || edit === undefined) return undefined;
	if (fix.kind === 'rename-key') return { label: `Rename to ${fix.to}`, edit };
	return { label: 'Change the chart', note: `${fix.effect} Sets ${fix.path} to ${JSON.stringify(fix.value)}.`, edit };
}
