import type { Trace } from './trace.js';

export interface Decoded {
	readonly value: unknown;
	readonly complete: boolean;
	/** Where the value and its parts come from (CG-03-04); the decoder adds it to every result. */
	readonly trace?: Trace;
}

export const UNRESOLVED: Decoded = { value: undefined, complete: false };

export function known(value: unknown): Decoded {
	return { value, complete: true };
}
