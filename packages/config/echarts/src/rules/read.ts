import { type Item, itemsOf, readOwn } from '@chartguard/config-core';

/**
 * A timeline option (`baseOption`, `options`) is merged at runtime from its parts; what one part
 * lacks another may supply, so no rule speaks for a part. So is a root with `media`: echarts takes
 * the root as the base option and merges each matching `media[].option` into it (`hasMedia =
 * !!rawOption.media`, echarts lib/model/OptionManager.js:263; H10).
 */
export function isWholeOption(option: unknown): boolean {
	const base = readOwn(option, 'baseOption');
	const parts = readOwn(option, 'options');
	const media = readOwn(option, 'media');
	const noMedia = media.known && !Boolean(media.value);
	return base.known && parts.known && base.value === undefined && parts.value === undefined && noMedia;
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
