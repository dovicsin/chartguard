import {
	type Fact,
	holds,
	isBoolean,
	isString,
	type Item,
	itemsAt,
	type PathSegment,
	readFact,
	type UnknownReason
} from '@chartguard/quality-core';

const isMode = (value: unknown): value is boolean | string => isBoolean(value) || isString(value);
const isAnything = (value: unknown): value is unknown => value !== undefined;

/**
 * Why a legend may hide the series named `name`, or undefined when none does. echarts drops a series
 * from the drawn chart, its axis extents included, when any legend has it unselected
 * (`legendFilter`, echarts lib/component/legend/legendFilter.js:55): `selected[name]` falsy
 * (`isSelected`, LegendModel.js:229); a single-select legend unselects every name but one
 * (`optionUpdated`, LegendModel.js:109). A hidden series is not modelled, so its values are unknown (K11).
 */
export function legendHides(config: unknown, item: Item, own: Fact<string>): UnknownReason | undefined {
	const name = nameOf(item, own);
	const legends = itemsAt(config, ['legend'], { single: true });
	if (!legends.known) return legends.reason;
	for (const { segments } of legends.items) {
		const reason = hiddenBy(config, segments, name);
		if (reason !== undefined) return reason;
	}
	return undefined;
}

/**
 * The name echarts lists a series under: its own, or for a series without one `'series\0'` and its
 * index (`DUMMY_COMPONENT_NAME_PREFIX + index`, echarts lib/util/model.js:341).
 */
function nameOf(item: Item, own: Fact<string>): Fact<string> {
	if (own.known || own.reason !== 'unset') return own;
	const index = item.segments.at(-1);
	return {
		known: true,
		value: `series\0${String(typeof index === 'number' ? index : 0)}`,
		path: own.path,
		source: 'config'
	};
}

/** Why the legend at `segments` may hide the series named `name`, or undefined when it shows it. */
function hiddenBy(config: unknown, segments: readonly PathSegment[], name: Fact<string>): UnknownReason | undefined {
	const mode = readFact(config, [...segments, 'selectedMode'], isMode);
	if (!mode.known) return mode.reason === 'unset' ? listed(config, segments, name) : mode.reason;
	return mode.value === 'single' ? 'unmodelled' : listed(config, segments, name);
}

/** Why the legend's `selected` may unselect the series named `name`. */
function listed(config: unknown, segments: readonly PathSegment[], name: Fact<string>): UnknownReason | undefined {
	if (!holds(config, [...segments, 'selected'])) return undefined;
	if (!name.known) return name.reason;
	const selected = readFact(config, [...segments, 'selected', name.value], isAnything);
	if (!selected.known) return selected.reason === 'unset' ? undefined : selected.reason;
	return Boolean(selected.value) ? undefined : 'unmodelled';
}
