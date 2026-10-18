import type { LibraryId } from './libraries.js';
import type { Verdict } from './runtime.js';

/** A runtime-verified fixture from the package corpora, generated into examples.json at build time. */
export interface Example {
	readonly id: string;
	readonly library: LibraryId;
	readonly title: string;
	/** `valid`: renders silently, no findings. `contract`: findings and runtime verdict pinned together. */
	readonly group: 'valid' | 'contract';
	readonly config: unknown;
	readonly expected?: {
		readonly findings: readonly string[];
		readonly runtime: Verdict;
		readonly why?: string;
	};
}

function isJsonPrimitive(value: unknown): boolean {
	if (typeof value === 'number') return Number.isFinite(value);
	return value === null || typeof value === 'string' || typeof value === 'boolean';
}

function isPlainObject(value: object): boolean {
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Plain JSON values only: the playground shows configs as editable JSON and never runs code. */
export function isJsonSafe(value: unknown, seen = new Set<unknown>()): boolean {
	if (typeof value !== 'object' || value === null) return isJsonPrimitive(value);
	if (seen.has(value)) return false;
	seen.add(value);
	if (Array.isArray(value))
		return value.length === Object.keys(value).length && value.every((item) => isJsonSafe(item, seen));
	return isPlainObject(value) && Object.values(value).every((entry) => isJsonSafe(entry, seen));
}

export const formatJson = (config: unknown): string => JSON.stringify(config, null, 2);
