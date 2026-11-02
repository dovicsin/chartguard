import { ownDataProperty } from '@chartguard/core';

/** The runs of holes in a list, reported as one finding each (`$.a[3..9]`). */
export interface HoleRun {
	readonly first: number;
	readonly last: number;
}

export function holeRuns(items: ArrayLike<unknown>, count: number): HoleRun[] {
	const runs: HoleRun[] = [];
	for (let index = 0; index < count; index++) {
		if (ownDataProperty(items, String(index)).found) continue;
		const open = runs.at(-1);
		if (open?.last === index - 1) runs[runs.length - 1] = { first: open.first, last: index };
		else runs.push({ first: index, last: index });
	}
	return runs;
}

export function rangeSegment({ first, last }: HoleRun): string {
	return first === last ? `[${String(first)}]` : `[${String(first)}..${String(last)}]`;
}
