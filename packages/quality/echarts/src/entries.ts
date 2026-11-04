import {
	type Default,
	defaulted,
	type Fact,
	holds,
	isBoolean,
	isDefined,
	type Item,
	itemsAt,
	type PathSegment,
	readFact,
	type TitleSemantics,
	unknown,
	type UnknownFact,
	unreadable
} from '@chartguard/quality-core';

/** echarts names a series without `name` `'series\0'` and its index (`DUMMY_COMPONENT_NAME_PREFIX + index`). */
const UNNAMED = 'echarts@6.1.0 dist/echarts.js:8652 : DUMMY_COMPONENT_NAME_PREFIX + index;';
/** A legend without `data` lists only the series with a name of their own (`isNameSpecified`). */
const UNLISTED: Default<boolean> = {
	value: false,
	pointer: 'echarts@6.1.0 dist/echarts.js:86950 if (isPotential && isNameSpecified(seriesModel)) {'
};
const LEGEND_SHOWN: Default<boolean> = {
	value: true,
	pointer: 'echarts@6.1.0 dist/echarts.js:87049 show: true, [after LegendModel.defaultOption = {]'
};
/**
 * Types whose legend entries are their data names (a `legendVisualProvider`: pie, radar, graph, chord,
 * funnel, themeRiver), not the series name.
 */
const BY_DATA = new Set(['pie', 'radar', 'graph', 'chord', 'funnel', 'themeRiver']);
/** Options from which echarts names an unnamed series after its data dimensions (`autoSeriesName`). */
const AUTO_NAMED = ['encode', 'dimensions', 'datasetIndex', 'datasetId'];

/** What the chart's legends decide for every series, read once per chart. */
export interface Legends {
	/** Why the drawn texts are not the names: a `formatter` (a function, or a template not modelled). */
	readonly text: UnknownFact | undefined;
	/** Whether any legend is drawn and lists the named series (one with `data` lists its own names). */
	readonly shown: Fact<boolean>;
}

/** One legend's `formatter`: why it leaves the texts unknown, or undefined when it has none. */
function formatterOf(config: unknown, segments: readonly PathSegment[]): UnknownFact | undefined {
	const formatter = readFact(config, [...segments, 'formatter'], isDefined);
	if (formatter.known) return unknown(formatter.path, typeof formatter.value === 'function' ? 'dynamic' : 'unmodelled');
	return unreadable(formatter) ? formatter : undefined;
}

/** One legend: drawn (`show`, true by default) and listing the named series, or why that is not known. */
function legendShown(config: unknown, segments: readonly PathSegment[]): Fact<boolean> {
	const data = readFact(config, [...segments, 'data'], isDefined);
	if (data.known) return unknown(data.path, 'unmodelled');
	if (unreadable(data)) return data;
	return readFact(config, [...segments, 'show'], isBoolean, LEGEND_SHOWN);
}

/** The legends of the chart (`legend`, one or a list): none draws no entry. */
export function legendsOf(config: unknown): Legends {
	const legends = itemsAt(config, ['legend'], { single: true });
	if (!legends.known) return { text: legends, shown: legends };
	const text = legends.items.map(({ segments }) => formatterOf(config, segments)).find(Boolean);
	const each = legends.items.map(({ segments }) => legendShown(config, segments));
	const decided = each.find((fact) => !fact.known) ??
		each.find((fact) => fact.known && fact.value) ??
		each[0] ?? { known: true, value: false, path: legends.path, source: 'config' };
	return { text, shown: decided };
}

/**
 * The name a series is listed under: its own; an unnamed one named after its data dimensions is not
 * modelled; else the name echarts makes up, which a legend lists only when its `data` names it.
 */
function nameOf(config: unknown, item: Item, name: Fact<string>): Fact<string> {
	if (name.known || name.reason !== 'unset') return name;
	if (holds(config, ['dataset']) || AUTO_NAMED.some((key) => holds(config, [...item.segments, key])))
		return unknown(name.path, 'unmodelled');
	const index = item.segments.at(-1);
	return defaulted({ value: `series\0${String(typeof index === 'number' ? index : 0)}`, pointer: UNNAMED }, name.path);
}

/** Whether a legend draws an entry for the series itself, under the name it is listed by. */
function entryShown(type: Fact<string>, listed: Fact<string>, drawn: Fact<boolean>): Fact<boolean> {
	if (!drawn.known || !drawn.value) return drawn;
	if (!listed.known) return unknown(listed.path, listed.reason);
	if (listed.source === 'default') return defaulted(UNLISTED, listed.path);
	if (!type.known) return unknown(type.path, type.reason);
	return BY_DATA.has(type.value) ? unknown(type.path, 'unmodelled') : drawn;
}

/** A series' legend entry: its name, as the legends draw it, and whether one of them lists it. */
export function legendOf(
	config: unknown,
	item: Item,
	{ type, name }: { type: Fact<string>; name: Fact<string> },
	legends: Legends
): TitleSemantics {
	const listed = nameOf(config, item, name);
	return { text: legends.text ?? listed, shown: entryShown(type, listed, legends.shown) };
}
