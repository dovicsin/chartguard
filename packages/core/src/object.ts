/** `accessor`: the key exists but holds a getter/setter, whose value cannot be known without running it. */
export type OwnProperty =
	{ readonly found: true; readonly value: unknown } | { readonly found: false; readonly accessor: boolean };

const MISSING: OwnProperty = { found: false, accessor: false };
const ACCESSOR: OwnProperty = { found: false, accessor: true };

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isContainer(value: unknown): value is object {
	return typeof value === 'object' && value !== null;
}

/**
 * Reads an own data property. Accessors are reported as missing so getters never run.
 * A Proxy is the caller's object: its `getOwnPropertyDescriptor` trap does run, and an error it throws propagates.
 */
export function ownDataProperty(target: object, key: string): OwnProperty {
	const descriptor = Object.getOwnPropertyDescriptor(target, key);
	if (descriptor === undefined) return MISSING;
	if (!('value' in descriptor)) return ACCESSOR;
	return { found: true, value: descriptor.value as unknown };
}
