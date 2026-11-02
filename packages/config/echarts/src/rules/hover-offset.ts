import { type ConfigRule, type Item, itemsOf, readOwn } from '@chartguard/config-core';
import { type Diagnostic, isRecord } from '@chartguard/core';

import { textAt } from './read.js';

/** A part of the option the preprocessors run on, with its path. */
interface Part {
	readonly value: unknown;
	readonly path: string;
}

/**
 * The parts `parseRawOption` (echarts lib/model/OptionManager.js) preprocesses one by one: the base
 * option (`baseOption`, else the root itself), each timeline option and each media option. A part
 * that cannot be read is left out: nothing is claimed about it.
 */
function partsOf(option: unknown): Part[] {
	const base = readOwn(option, 'baseOption');
	const root = base.known
		? [base.value === undefined ? { value: option, path: '$' } : { value: base.value, path: '$.baseOption' }]
		: [];
	return [...root, ...listedParts(option, 'options', ''), ...listedParts(option, 'media', '.option')];
}

/** The parts listed under `key` (`options[i]`, `media[i].option`), each read at `inner` below its item. */
function listedParts(option: unknown, key: string, inner: string): Part[] {
	const list = readOwn(option, key);
	if (!list.known || !Array.isArray(list.value)) return [];
	return (itemsOf(list.value, `$.${key}`) ?? []).flatMap(({ value, path }) => {
		const part = inner === '' ? { known: true as const, value } : readOwn(value, inner.slice(1));
		return part.known ? [{ value: part.value, path: `${path}${inner}` }] : [];
	});
}

/** Set, as the runtime tests it (`!= null`). */
const isSet = (value: unknown): boolean => value !== null && value !== undefined;

const SERIES = new Set(['pie', 'gauge']);

/** The series of a part the backward-compat branch for `pie` and `gauge` reaches, with a set `hoverOffset`. */
function offsetSeries({ value, path }: Part): Item[] {
	const series = readOwn(value, 'series');
	const items = series.known ? (itemsOf(series.value, `${path}.series`) ?? []) : [];
	return items.filter((item) => {
		const type = textAt(item.value, 'type');
		const offset = readOwn(item.value, 'hoverOffset');
		return typeof type === 'string' && SERIES.has(type) && offset.known && isSet(offset.value);
	});
}

/**
 * `globalBackwardCompat` (echarts lib/preprocessor/backwardCompat.js) means to copy a pie's or
 * gauge's `hoverOffset` into `emphasis.scaleSize`, but its test assigns instead of comparing
 * (`if (seriesOpt.emphasis.scaleSize = null)`): the value of `hoverOffset` is never applied, and
 * `emphasis.scaleSize` is set to null, so an `emphasis.scaleSize` beside it is without effect and a
 * pie no longer grows on hover (`scaleSize || 0`, lib/chart/pie/PieView.js) (CG-02-11).
 */
export const hoverOffset: ConfigRule = {
	id: 'echarts/hover-offset',
	check(option, context) {
		return partsOf(option).flatMap((part) =>
			offsetSeries(part).flatMap((item): Diagnostic[] => {
				const emphasis = readOwn(item.value, 'emphasis');
				const scaleSize = readOwn(item.value, 'emphasis', 'scaleSize');
				// Only a pie reads emphasis.scaleSize; on a gauge it is an unknown key, never in effect anyway.
				const pie = textAt(item.value, 'type') === 'pie';
				const erased = pie && emphasis.known && isRecord(emphasis.value) && scaleSize.known && isSet(scaleSize.value);
				return [
					context.warned(
						'CFG_INEFFECTIVE',
						`${item.path}.hoverOffset`,
						pie
							? 'echarts never applies the value of hoverOffset: its compatibility code sets emphasis.scaleSize to null instead of copying hoverOffset into it, so the pie no longer grows on hover.'
							: 'echarts never applies the value of hoverOffset: its compatibility code sets emphasis.scaleSize to null instead of copying hoverOffset into it.',
						'Remove hoverOffset and set emphasis.scaleSize instead.'
					),
					...(erased
						? [
								context.warned(
									'CFG_INEFFECTIVE',
									`${item.path}.emphasis.scaleSize`,
									'echarts erases emphasis.scaleSize when hoverOffset is set beside it (its compatibility code assigns null to it).',
									'Remove hoverOffset to keep this scaleSize.'
								)
							]
						: [])
				];
			})
		);
	}
};
