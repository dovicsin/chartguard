export interface Decoded {
	readonly value: unknown;
	readonly complete: boolean;
}

export const UNRESOLVED: Decoded = { value: undefined, complete: false };

export function known(value: unknown): Decoded {
	return { value, complete: true };
}
