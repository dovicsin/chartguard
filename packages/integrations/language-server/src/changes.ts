import { Lines, type Position } from './positions.js';

/**
 * An editor's content changes (CG-07-03: incremental sync) applied as LSP means them: each in turn,
 * its range in positions of the text the change before it left. A batch is applied in passes over the
 * text, each taking the changes that lie on one side of the one before them: VS Code sends a
 * replace-all last match first, a client that waits for more sends typing first change first, and
 * either takes one pass however many changes it holds (E73). A batch in no order takes a pass per
 * turn, and one whose passes read more than WORK_FACTOR times its text leaves the text unknown.
 */

/** Passes over a batch's own text (its document and the texts it inserts) that a batch may cost. */
const WORK_FACTOR = 16;
/** Code units any batch may read: a small document affords many passes. */
const WORK_SLACK = 1 << 20;

interface Change {
	readonly text: string;
	readonly range?: { readonly start: Position; readonly end: Position };
}

interface Edit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	/** The first code unit of the text from `start` once applied (NaN at its end). */
	readonly head: number;
}

/** What a pass leaves: its text and how many changes it took. */
interface Pass {
	readonly text: string;
	readonly count: number;
}

const CR = 13;
const LF = 10;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isPosition = (value: unknown): value is Position =>
	isRecord(value) &&
	Number.isSafeInteger(value['line']) &&
	Number.isSafeInteger(value['character']) &&
	(value['line'] as number) >= 0 &&
	(value['character'] as number) >= 0;

/** A change in shape: a whole text, or a text for a range; undefined when malformed. */
function changeOf(value: unknown): Change | undefined {
	if (!isRecord(value) || typeof value['text'] !== 'string') return undefined;
	if (!Object.hasOwn(value, 'range')) return { text: value['text'] };
	const range = value['range'];
	if (!isRecord(range) || !isPosition(range['start']) || !isPosition(range['end'])) return undefined;
	return { text: value['text'], range: { start: range['start'], end: range['end'] } };
}

const atOrBefore = (a: Position, b: Position): boolean =>
	a.line < b.line || (a.line === b.line && a.character <= b.character);

/** Whether a range lies wholly at or before `limit` (a position not yet changed) or wholly at or after it. */
const within = (range: Change['range'], limit: Position, before: boolean): range is NonNullable<Change['range']> =>
	range !== undefined &&
	(before
		? atOrBefore(range.start, limit) && atOrBefore(range.end, limit)
		: atOrBefore(limit, range.start) && atOrBefore(limit, range.end));

/** A change as an edit of `text` after `previous` (an edit after it), or undefined when malformed. */
function editOf(
	text: string,
	lines: Lines,
	{ range, text: inserted }: Change,
	previous: Edit | undefined
): Edit | undefined {
	if (range === undefined) return undefined;
	const start = lines.offsetOf(range.start);
	const end = lines.offsetOf(range.end);
	if (end < start) return undefined;
	const after = end === previous?.start ? previous.head : text.charCodeAt(end);
	return { start, end, text: inserted, head: inserted === '' ? after : inserted.charCodeAt(0) };
}

/**
 * The changes from `first` that each lie at or before the start of the one before them, as edits of
 * `text`: the text before a change's start is the pass's own, so are its positions. A CR before a
 * change that meets an LF after it makes one terminator of the two, and ends the pass there.
 * Undefined when a change is malformed.
 */
function descending(text: string, lines: Lines, changes: readonly Change[], first: number): Edit[] | undefined {
	const edits: Edit[] = [];
	for (const change of changes.slice(first)) {
		const previous = edits.at(-1);
		if (previous !== undefined && text.charCodeAt(previous.start - 1) === CR && previous.head === LF) break;
		if (!within(change.range, lines.positionOf(previous?.start ?? text.length), true)) break;
		const edit = editOf(text, lines, change, previous);
		if (edit === undefined) return undefined;
		edits.push(edit);
	}
	return edits;
}

/** `text` with `edits`, each wholly before the one before it, applied. */
function joined(text: string, edits: readonly Edit[]): string {
	const pieces: string[] = [];
	let from = 0;
	for (const { start, end, text: inserted } of [...edits].reverse()) {
		pieces.push(text.slice(from, start), inserted);
		from = end;
	}
	pieces.push(text.slice(from));
	return pieces.join('');
}

/**
 * A text built from the front: what is built so far, its end in positions (lines, the code units after
 * the last, whether it ends with a CR), and where the rest of the pass's text starts. A position at
 * or after that end maps to the pass's text through the line the end is on.
 */
class Ahead {
	private readonly pieces: string[] = [];
	private readonly end = { line: 0, character: 0 };
	private cr = false;
	private consumed = 0;
	count = 0;

	constructor(
		private readonly text: string,
		private readonly lines: Lines
	) {}

	/** Whether `range` lies wholly ahead; a CR built that meets an LF in the rest is one terminator, and is not. */
	takes(range: Change['range']): range is NonNullable<Change['range']> {
		return within(range, this.end, false) && !(this.cr && this.text.charCodeAt(this.consumed) === LF);
	}

	offsetOf({ line, character }: Position): number {
		const from = this.lines.positionOf(this.consumed);
		return this.lines.offsetOf(
			line === this.end.line
				? { line: from.line, character: from.character + character - this.end.character }
				: { line: from.line + line - this.end.line, character }
		);
	}

	apply(start: number, end: number, inserted: string): void {
		this.advance(this.text, this.consumed, start);
		this.advance(inserted, 0, inserted.length);
		this.pieces.push(this.text.slice(this.consumed, start), inserted);
		this.consumed = end;
		this.count += 1;
	}

	built(): string {
		return this.pieces.join('') + this.text.slice(this.consumed);
	}

	private advance(text: string, from: number, to: number): void {
		for (let index = from; index < to; index++) {
			const code = text.charCodeAt(index);
			// The LF of a CRLF ends no line of its own, even when the CR came before this piece.
			if (code !== LF || !this.cr) this.end.character += 1;
			if ((code === LF && !this.cr) || code === CR) [this.end.line, this.end.character] = [this.end.line + 1, 0];
			this.cr = code === CR;
		}
	}
}

/** The changes from `first` that each lie at or after the end of the one before them, applied to `text`. */
function ascending(text: string, lines: Lines, changes: readonly Change[], first: number): Pass | undefined {
	const ahead = new Ahead(text, lines);
	for (const { range, text: inserted } of changes.slice(first)) {
		if (!ahead.takes(range)) break;
		const start = ahead.offsetOf(range.start);
		const end = ahead.offsetOf(range.end);
		if (end < start) return undefined;
		ahead.apply(start, end, inserted);
	}
	return { text: ahead.built(), count: ahead.count };
}

/** One pass over `text` from `changes[first]`: the text it leaves and the changes it took, or undefined. */
function pass(text: string, lines: Lines, changes: readonly Change[], first: number): Pass | undefined {
	const head = changes[first];
	if (head?.range === undefined) return { text: head?.text ?? text, count: 1 };
	const edits = descending(text, lines, changes, first);
	if (edits === undefined) return undefined;
	return edits.length > 1 ? { text: joined(text, edits), count: edits.length } : ascending(text, lines, changes, first);
}

/**
 * The text after an editor's content changes, with its lines and the passes it took. Undefined when a
 * change is malformed or the batch costs more than its bound: the text is then unknown.
 */
export function changedText(
	text: string,
	lines: Lines,
	changes: unknown
): { text: string; lines: Lines; passes: number } | undefined {
	if (!Array.isArray(changes)) return undefined;
	const read = changes.map(changeOf);
	if (!read.every((change): change is Change => change !== undefined)) return undefined;
	const budget = WORK_FACTOR * read.reduce((sum, change) => sum + change.text.length, text.length) + WORK_SLACK;
	let current = { text, lines };
	let [work, passes] = [0, 0];
	for (let first = 0; first < read.length; passes++) {
		work += current.text.length;
		const result = work > budget ? undefined : pass(current.text, current.lines, read, first);
		if (result === undefined) return undefined;
		current = { text: result.text, lines: new Lines(result.text) };
		first += result.count;
	}
	return { ...current, passes };
}
