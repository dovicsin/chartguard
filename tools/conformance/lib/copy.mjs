/** A plain object of any realm: its prototype is null or that realm's `Object.prototype`. */
function isPlainObject(value) {
	if (value === null || typeof value !== 'object') return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * A copy of the plain objects and arrays in `value`, built in this realm; functions, class
 * instances, dates and typed arrays are shared, not copied. Used for two reasons:
 * - objects built inside a `vm` context belong to another realm, and runtimes test
 *   `value.constructor === Object` (Chart.js `needsSubResolver`) to decide whether to merge defaults;
 * - runtimes write into the config they are given (Chart.js adds its default scales), so a
 *   fixture rendered once must not carry the runtime's additions into the next check.
 */
export function copyPlain(value, copies = new Map()) {
	if (copies.has(value)) return copies.get(value);
	if (Array.isArray(value)) {
		const copy = [];
		copies.set(value, copy);
		for (let index = 0; index < value.length; index++)
			if (index in value) copy[index] = copyPlain(value[index], copies);
		copy.length = value.length;
		return copy;
	}
	if (!isPlainObject(value)) return value;
	const copy = {};
	copies.set(value, copy);
	for (const [key, entry] of Object.entries(value)) copy[key] = copyPlain(entry, copies);
	return copy;
}
