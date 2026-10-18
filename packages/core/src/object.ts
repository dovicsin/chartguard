export type OwnProperty = { readonly found: true; readonly value: unknown } | { readonly found: false };

const MISSING: OwnProperty = { found: false };

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
	if (descriptor === undefined || !('value' in descriptor)) return MISSING;
	return { found: true, value: descriptor.value as unknown };
}
