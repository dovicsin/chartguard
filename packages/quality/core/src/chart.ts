/** Library-neutral facts about a chart; `undefined` means the fact is unknown. */
export interface NormalizedChart {
	kind?: string | undefined;
	yMin?: number | undefined;
	yMax?: number | undefined;
	title?: string | undefined;
	seriesValues?: number[] | undefined;
	accessibleDescription?: string | undefined;
}
