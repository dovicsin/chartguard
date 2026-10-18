/** A fact read from a config together with the path it was read from, so a finding can point at it. */
export interface Fact<T> {
	readonly value: T;
	readonly path: string;
}

/** Library-neutral facts about a chart; `undefined` means the fact is unknown. */
export interface NormalizedChart {
	readonly kind?: Fact<string> | undefined;
	readonly yMin?: Fact<number> | undefined;
	readonly title?: Fact<string> | undefined;
}
