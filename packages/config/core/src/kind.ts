/**
 * Typed arrays (`Float32Array`, …) are array-likes the chart runtimes accept wherever they take
 * data arrays (ECharts `isArrayLike`/`isTypedArray`). `DataView` is a buffer view but not a list.
 */
export function isListLike(value: unknown): value is ArrayLike<unknown> {
	return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

/** Runtime kind of a value in schema terms. */
export function kindOf(value: unknown): string {
	if (value === null) return 'null';
	if (isListLike(value)) return 'array';
	return typeof value;
}
