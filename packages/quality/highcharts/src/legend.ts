import {
	type Default,
	defaulted,
	type Fact,
	holds,
	isBoolean,
	isDefined,
	isString,
	type Item,
	type Listed,
	readFact,
	type TitleSemantics,
	unknown,
	type UnknownFact,
	unreadable
} from '@chartguard/quality-core';

import { seriesOption, seriesType } from './type.js';

/** A series without `name` is named from the language's `seriesName`, "Series {add index 1}" (`Series#getName`). */
const SERIES_NAME = "highcharts@13.1.1 highcharts.src.js:4936 seriesName: 'Series {add index 1}',";
const ENABLED: Default<boolean> = {
	value: true,
	pointer: 'highcharts@13.1.1 highcharts.src.js:5788 enabled: true, [in legend: {]'
};
/** A series is in the legend unless `showInLegend` says otherwise; a linked one is not by default (`getAllItems`). */
const IN_LEGEND = 'highcharts@13.1.1 highcharts.src.js:37392 (seriesOptions.showInLegend ??';
/** Series types whose legend entry is the series itself; a pie lists its points (`legendType: 'point'`, :47085). */
const LISTED = new Set(['line', 'spline', 'area', 'areaspline', 'column', 'bar', 'scatter']);

/** A series name: a string, or `null`, which `getName` treats as none (`name ?? …`). */
const isName = (value: unknown): value is string | null => value === null || typeof value === 'string';

/** What the chart decides for every legend entry, read once per chart. */
export interface Legend {
	/** Whether the legend is drawn (`legend.enabled`, true by default) and its entries are modelled. */
	readonly enabled: Fact<boolean>;
	/** Why a drawn text is not the series name (`labelFormatter`, `labelFormat`). */
	readonly format: UnknownFact | undefined;
	/** Why a made-up name is not modelled: `lang.seriesName` set, or a series `index` that reorders the chart's series. */
	readonly naming: UnknownFact | undefined;
}

/** Why an option that changes what is drawn leaves it unknown: set (`reason`), or unreadable. */
function changedBy(fact: Fact<unknown>, reason: UnknownFact['reason']): UnknownFact | undefined {
	if (fact.known) return unknown(fact.path, typeof fact.value === 'function' ? 'dynamic' : reason);
	return unread(fact);
}

/** A series `index` (in any scope) reorders the chart's series, and the made-up names with them (`insertItem`). */
function reordered(config: unknown, items: Listed<Item>): UnknownFact | undefined {
	if (!items.known) return items;
	for (const item of items.items) {
		const index = seriesOption(config, item, seriesType(config, item), { name: 'index', is: isDefined });
		const why = changedBy(index, 'unmodelled');
		if (why !== undefined) return why;
	}
	return undefined;
}

export function legendOf(config: unknown, items: Listed<Item>): Legend {
	const enabled = readFact(config, ['legend', 'enabled'], isBoolean, ENABLED);
	// A colour axis can take the series' place in the legend (the coloraxis module): not modelled.
	const colorAxis = holds(config, ['colorAxis']) ? unknown('$.colorAxis', 'unmodelled') : undefined;
	return {
		enabled: enabled.known && enabled.value && colorAxis !== undefined ? colorAxis : enabled,
		format:
			changedBy(readFact(config, ['legend', 'labelFormatter'], isDefined), 'dynamic') ??
			changedBy(readFact(config, ['legend', 'labelFormat'], isDefined), 'unmodelled'),
		naming: changedBy(readFact(config, ['lang', 'seriesName'], isDefined), 'unmodelled') ?? reordered(config, items)
	};
}

/** The name a series is drawn under: its own, else "Series" and its place in the chart. */
function nameOf(config: unknown, item: Item, type: Fact<string>, legend: Legend): Fact<string> {
	const own = readFact(config, [...item.segments, 'name'], isName);
	if (own.known && own.value !== null) return { ...own, value: own.value };
	if (!own.known && own.reason !== 'unset') return own;
	// A series mapped to a data column takes the column's name (`dataMapping`): not modelled.
	const mapped = changedBy(seriesOption(config, item, type, { name: 'dataMapping', is: isDefined }), 'unmodelled');
	const why = mapped ?? legend.naming;
	if (why !== undefined) return unknown(own.path, why.reason);
	const index = item.segments.at(-1);
	return defaulted(
		{ value: `Series ${String(typeof index === 'number' ? index + 1 : 1)}`, pointer: SERIES_NAME },
		own.path
	);
}

/** A fact set in the config that cannot be read (a getter, a function, another shape), or undefined. */
const unread = <T>(fact: Fact<T>): UnknownFact | undefined =>
	!fact.known && fact.reason !== 'unset' ? fact : undefined;

/** Whether a series in the legend shows itself there: `showInLegend`, by default unless `linkedTo` is set. */
function shownInLegend(config: unknown, item: Item, type: Fact<string>): Fact<boolean> {
	const own = seriesOption(config, item, type, { name: 'showInLegend', is: isBoolean });
	if (own.known || unreadable(own)) return own;
	const linked = seriesOption(config, item, type, { name: 'linkedTo', is: isDefined });
	return unread(linked) ?? defaulted({ value: !linked.known, pointer: IN_LEGEND }, own.path);
}

/** Whether the legend draws an entry for the series itself (not for its points, `legendType: 'point'`). */
function entryShown(config: unknown, item: Item, type: Fact<string>, enabled: Fact<boolean>): Fact<boolean> {
	if (!enabled.known || !enabled.value) return enabled;
	if (!type.known) return unknown(type.path, type.reason);
	if (!LISTED.has(type.value)) return unknown(item.path, type.value === 'pie' ? 'inapplicable' : 'unmodelled');
	const legendType = seriesOption(config, item, type, { name: 'legendType', is: isString });
	if (legendType.known && legendType.value === 'point') return unknown(legendType.path, 'inapplicable');
	return unread(legendType) ?? shownInLegend(config, item, type);
}

/** A series' legend entry: the text drawn and whether it is drawn. */
export function entryOf(config: unknown, item: Item, legend: Legend): TitleSemantics {
	const type = seriesType(config, item);
	const text = legend.format ?? nameOf(config, item, type, legend);
	return { text, shown: entryShown(config, item, type, legend.enabled) };
}
