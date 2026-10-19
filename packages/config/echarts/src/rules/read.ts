import { type Item, itemsOf, readOwn } from '@chartguard/config-core';

/**
 * A timeline option (`baseOption`, `options`) is merged at runtime from its parts; what one part
 * lacks another may supply, so no rule speaks for a part.
 */
export function isWholeOption(option: unknown): boolean {
	const base = readOwn(option, 'baseOption');
	const parts = readOwn(option, 'options');
	return base.known && parts.known && base.value === undefined && parts.value === undefined;
}

/** The items of a root option that takes one object or a list (`series`, `xAxis`); undefined when unreadable. */
export function itemsAt(option: unknown, key: string): readonly Item[] | undefined {
	const read = readOwn(option, key);
	return read.known ? itemsOf(read.value, `$.${key}`) : undefined;
}

/** A string own value; `null` when absent; undefined when it is anything else or cannot be read. */
export function textAt(value: unknown, key: string): string | null | undefined {
	const read = readOwn(value, key);
	if (!read.known) return undefined;
	if (read.value === undefined) return null;
	return typeof read.value === 'string' ? read.value : undefined;
}

export const isIndex = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0;
