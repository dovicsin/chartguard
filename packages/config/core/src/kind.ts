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

/**
 * A plain object of any realm (an iframe, a vm context): its prototype is null or a root prototype
 * with no enumerable members of its own, never an object that inherits data (`Object.create({ a: 1 })`),
 * a class instance or a platform object. Lists are not plain objects.
 */
export function isPlainData(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || isListLike(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype === null) return true;
	return (
		typeof prototype === 'object' && Object.getPrototypeOf(prototype) === null && Object.keys(prototype).length === 0
	);
}
