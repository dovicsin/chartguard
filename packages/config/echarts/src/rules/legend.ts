import { type ConfigRule, type Item, itemsOf, readOwn, type RuleContext } from '@chartguard/config-core';
import { type Diagnostic, suggestion } from '@chartguard/core';

import { isWholeOption, itemsAt, textAt } from './read.js';

/** Built-in series types; an extension type may name legend entries in ways this rule cannot know. */
const BUILT_IN = new Set([
	'line',
	'bar',
	'pie',
	'scatter',
	'effectScatter',
	'radar',
	'tree',
	'treemap',
	'sunburst',
	'boxplot',
	'candlestick',
	'heatmap',
	'map',
	'parallel',
	'lines',
	'graph',
	'sankey',
	'funnel',
	'gauge',
	'pictorialBar',
	'themeRiver',
	'custom',
	'chord'
]);

/**
 * Series types with a `legendVisualProvider` (echarts/lib/chart/*): their legend entries are also
 * the names of their data items (pie, funnel, radar, chord: `data` and `nodes`), of their graph
 * categories, or the third value of their themeRiver tuples.
 */
const ITEM_NAMES: Readonly<Record<string, readonly string[]>> = {
	pie: ['data'],
	funnel: ['data'],
	radar: ['data'],
	chord: ['data', 'nodes'],
	graph: ['categories']
};

/** A name as ECharts keys it: a string, or a number it turns into one; undefined for anything else. */
function nameOf(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	return typeof value === 'number' ? String(value) : undefined;
}

/** An item's name: null for none (a bare value, which the runtime names ''); undefined when it cannot be known. */
function itemName(value: unknown, tuple: number | undefined): string | null | undefined {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return null;
	// A value array is a point whose name the series' dimensions decide; only themeRiver fixes its position.
	if (Array.isArray(value) && tuple === undefined) return undefined;
	const name = readOwn(value, tuple ?? 'name');
	if (!name.known) return undefined;
	return name.value === undefined ? null : nameOf(name.value);
}

/** The names of a list's items; undefined when one of them cannot be known. */
function itemNames(series: unknown, key: string, tuple?: number): string[] | undefined {
	const read = readOwn(series, key);
	const items = read.known ? itemsOf(read.value, '') : undefined;
	if (items === undefined) return undefined;
	const names = items.map(({ value }) => itemName(value, tuple));
	if (names.includes(undefined)) return undefined;
	return names.filter((name): name is string => typeof name === 'string');
}

/** Whether a provider series' data is inline: not taken from a dataset, and present where the type needs it. */
function hasInlineData(series: unknown, type: string): boolean | undefined {
	const viaDataset = readOwn(series, 'datasetIndex');
	const data = readOwn(series, 'data');
	if (!viaDataset.known || !data.known) return undefined;
	// A chord may give its names as `nodes` alone; the others read them from `data`.
	return viaDataset.value === undefined && (data.value !== undefined || type === 'chord');
}

/** Data names a provider series draws from, or undefined when they come from a dataset or cannot be read. */
function providerNames(series: unknown, type: string): string[] | undefined {
	if (type === 'themeRiver') return itemNames(series, 'data', 2);
	const keys = ITEM_NAMES[type] ?? [];
	if (keys.length === 0) return [];
	if (keys.includes('data') && hasInlineData(series, type) !== true) return undefined;
	const names: string[] = [];
	for (const key of keys) {
		const listed = itemNames(series, key);
		if (listed === undefined) return undefined;
		names.push(...listed);
	}
	return names;
}

/** A series' own name as ECharts keys it: none, a name, or undefined when it cannot be known. */
function seriesName(series: unknown): string | null | undefined {
	const name = readOwn(series, 'name');
	if (!name.known) return undefined;
	return name.value === undefined ? null : nameOf(name.value);
}

/** Every name a legend entry may match, or undefined when any series' names cannot be known. */
function knownNames(series: readonly Item[]): ReadonlySet<string> | undefined {
	const names = new Set<string>();
	for (const { value } of series) {
		const type = textAt(value, 'type');
		const name = seriesName(value);
		const fromItems = typeof type === 'string' && BUILT_IN.has(type) ? providerNames(value, type) : undefined;
		if (name === undefined || fromItems === undefined) return undefined;
		if (name !== null) names.add(name);
		for (const item of fromItems) names.add(item);
	}
	return names;
}

/** `''` and `'\n'` are line breaks in a legend; anything else names what it shows. */
const isLineBreak = (name: string): boolean => name === '' || name === '\n';

function entryName(entry: unknown): string | undefined {
	if (typeof entry === 'string') return entry;
	const name = readOwn(entry, 'name');
	return name.known && typeof name.value === 'string' ? name.value : undefined;
}

function unknownEntries(legend: Item, names: ReadonlySet<string>, context: RuleContext): Diagnostic[] {
	const data = readOwn(legend.value, 'data');
	const entries = data.known ? itemsOf(data.value, `${legend.path}.data`) : undefined;
	const seen = new Set<string>();
	return (entries ?? []).flatMap((entry) => {
		const name = entryName(entry.value);
		if (name === undefined || isLineBreak(name) || seen.has(name) || names.has(name)) return [];
		seen.add(name);
		const match = suggestion(name, [...names]);
		const message = `"${name}" names no series and no data item; the runtime warns and draws no legend entry for it.`;
		return [
			context.warned(
				'CFG_UNKNOWN_REFERENCE',
				entry.path,
				message,
				match === undefined ? undefined : `Did you mean "${match}"?`
			)
		];
	});
}

/**
 * `LegendView` (echarts/lib/component/legend/LegendView.js) warns "<name> series not exists. Legend
 * data should be same with series name or data name." for a `legend.data` entry that matches no
 * series name and no name a legend-providing series draws from.
 */
export const legendNames: ConfigRule = {
	id: 'echarts/legend-names',
	check(option, context) {
		const legends = isWholeOption(option) ? itemsAt(option, 'legend') : undefined;
		const series = itemsAt(option, 'series');
		const names = series === undefined ? undefined : knownNames(series);
		if (legends === undefined || names === undefined) return [];
		return legends.flatMap((legend) => unknownEntries(legend, names, context));
	}
};
