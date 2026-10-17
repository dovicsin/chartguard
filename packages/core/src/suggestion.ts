/** Levenshtein distance with a single rolling row. */
function editDistance(source: string, target: string): number {
	const row = Array.from({ length: target.length + 1 }, (_, index) => index);
	for (let i = 1; i <= source.length; i++) {
		let diagonal = i - 1;
		row[0] = i;
		for (let k = 1; k <= target.length; k++) {
			const above = row[k] ?? 0;
			const left = row[k - 1] ?? 0;
			const substitution = source.charAt(i - 1) === target.charAt(k - 1) ? 0 : 1;
			row[k] = Math.min(left + 1, above + 1, diagonal + substitution);
			diagonal = above;
		}
	}
	return row[target.length] ?? 0;
}

/** Closest candidate within a typo-sized edit distance, if any. */
export function suggestion(input: string, candidates: readonly string[]): string | undefined {
	const threshold = Math.max(1, Math.floor(input.length / 4));
	let best: string | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = editDistance(input, candidate);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return bestDistance <= threshold ? best : undefined;
}
