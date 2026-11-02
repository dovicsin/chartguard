/** An LSP position: a 0-based line and UTF-16 character, lines ended by `\r\n`, `\r` or `\n` only. */
export interface Position {
	readonly line: number;
	readonly character: number;
}

export interface Range {
	readonly start: Position;
	readonly end: Position;
}

/**
 * Converts offsets into a text to LSP positions. LSP ends lines at `\r\n`, `\r` and `\n` only, while
 * TypeScript (and so the findings' own line numbers) also ends them at U+2028 and U+2029: positions
 * are computed from offsets, never carried over from line numbers.
 */
export class Lines {
	private readonly starts: number[] = [0];

	constructor(text: string) {
		for (let index = 0; index < text.length; index++) {
			const code = text.charCodeAt(index);
			if (code === 13 && text.charCodeAt(index + 1) === 10) index++;
			if (code === 13 || code === 10) this.starts.push(index + 1);
		}
	}

	positionOf(offset: number): Position {
		let low = 0;
		let high = this.starts.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if ((this.starts[middle] ?? 0) <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low, character: offset - (this.starts[low] ?? 0) };
	}

	rangeOf(start: number, end: number): Range {
		return { start: this.positionOf(start), end: this.positionOf(end) };
	}
}

/** Whether two ranges share a position (touching ends count, as an editor's cursor does). */
export function overlaps(a: Range, b: Range): boolean {
	const before = (x: Position, y: Position): boolean =>
		x.line < y.line || (x.line === y.line && x.character < y.character);
	return !before(a.end, b.start) && !before(b.end, a.start);
}
