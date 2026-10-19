/** Survives the trip to another process or a page unchanged: no functions, `undefined`, class instances or non-finite numbers. */
export function isJson(value) {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJson);
	return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJson);
}

/** JSON values plus explicit `undefined`, which runtimes that merge options (Highcharts) treat differently from absence. */
export function isJsonOrUndefined(value) {
	if (value === undefined) return true;
	if (Array.isArray(value)) return value.every(isJsonOrUndefined);
	if (typeof value === 'object' && value !== null)
		return Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJsonOrUndefined);
	return isJson(value);
}
