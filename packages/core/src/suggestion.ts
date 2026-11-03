/** Names longer than this get no typo hint: a typo-sized edit of a long name is no longer a typo. */
const MAX_HINT_LENGTH = 100;
/** Distance cells one call may compute when the caller gives no budget of its own. */
const CALL_CELLS = 100_000;
/** Distance cells one run (a validation) may spend on hints, whatever the input holds. */
const RUN_CELLS = 2_000_000;

/**
 * The work typo hints may still do, in distance cells. Both the names and how many are compared come
 * from the input, so one run shares one budget; once it is spent, no further hint is searched for.
 */
export class SuggestionBudget {
	constructor(private left: number) {}

	/** The cells not yet spent. */
	get cells(): number {
		return this.left;
	}

	/** Spends `cells` when that many are left; false (nothing spent) otherwise. */
	spend(cells: number): boolean {
		if (this.left < cells) return false;
		this.left -= cells;
		return true;
	}
}

/** A fresh budget for one run (`cells`: for tests and callers with their own bound). */
export function suggestionBudget(cells: number = RUN_CELLS): SuggestionBudget {
	return new SuggestionBudget(cells);
}

/**
 * Levenshtein distance with a single rolling row, given only up to `limit`: `limit + 1` once every
 * cell of a row exceeds it, `undefined` when the budget is spent first.
 */
function distanceWithin(source: string, target: string, limit: number, budget: SuggestionBudget): number | undefined {
	const row = Array.from({ length: target.length + 1 }, (_, index) => index);
	for (let i = 1; i <= source.length; i++) {
		if (!budget.spend(target.length)) return undefined;
		let diagonal = i - 1;
		row[0] = i;
		let lowest = i;
		for (let k = 1; k <= target.length; k++) {
			const above = row[k] ?? 0;
			const left = row[k - 1] ?? 0;
			const substitution = source.charAt(i - 1) === target.charAt(k - 1) ? 0 : 1;
			row[k] = Math.min(left + 1, above + 1, diagonal + substitution);
			lowest = Math.min(lowest, row[k] ?? 0);
			diagonal = above;
		}
		if (lowest > limit) return limit + 1;
	}
	return row[target.length] ?? 0;
}

/**
 * Closest candidate within a typo-sized edit distance, if any: the first one at the smallest
 * distance. Bounded for untrusted names: none for a name over 100 characters, candidates whose length
 * alone rules them out are skipped, and the search stops (no hint) when `budget` is spent.
 */
export function suggestion(
	input: string,
	candidates: readonly string[],
	budget: SuggestionBudget = suggestionBudget(CALL_CELLS)
): string | undefined {
	if (input.length > MAX_HINT_LENGTH) return undefined;
	let best: string | undefined;
	let bestDistance = Math.max(1, Math.floor(input.length / 4)) + 1;
	for (const candidate of candidates) {
		// The distance is at least the difference in length: such a candidate cannot be closer.
		if (Math.abs(candidate.length - input.length) >= bestDistance) continue;
		const distance = distanceWithin(input, candidate, bestDistance - 1, budget);
		if (distance === undefined) return undefined;
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}
