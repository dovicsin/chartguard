import { isContainer, ownDataProperty } from '@chartguard/core';
import {
	type Fact,
	firstSet,
	formatPath,
	type Item,
	known,
	type Listed,
	type PathSegment,
	readFact,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined && typeof value !== 'function';

/** The option that colours a dataset, and the element whose options it falls back to. */
const COLORED_BY: Readonly<
	Record<string, { readonly key: 'borderColor' | 'backgroundColor'; readonly element: string }>
> = {
	line: { key: 'borderColor', element: 'line' },
	bar: { key: 'backgroundColor', element: 'bar' },
	scatter: { key: 'backgroundColor', element: 'point' },
	bubble: { key: 'backgroundColor', element: 'point' }
};

/** Chart.js's own colours, used when nothing else colours a dataset. */
const DEFAULT = {
	backgroundColor: "chart.js@4.5.1 dist/chunks/helpers.dataset.js:1024 this.backgroundColor = 'rgba(0,0,0,0.1)';",
	borderColor: "chart.js@4.5.1 dist/chunks/helpers.dataset.js:1025 this.borderColor = 'rgba(0,0,0,0.1)';"
} as const;

const NONE: Fact<boolean> = { known: true, value: false, path: '$', source: 'config' };

/** Whether `value` defines a colour as `containsColorsDefinitions` sees one (an own truthy colour); unknown behind a getter. */
function defines(value: unknown, path: string): Fact<boolean> {
	if (!isContainer(value)) return NONE;
	for (const key of ['borderColor', 'backgroundColor']) {
		const entry = ownDataProperty(value, key);
		if (!entry.found && entry.accessor) return unknown(path, 'accessor');
		if (entry.found && Boolean(entry.value)) return { known: true, value: true, path, source: 'config' };
	}
	return NONE;
}

/** The element options under `options.elements`, read through own data properties. */
function elementsOf(config: unknown): Fact<readonly { value: unknown; path: string }[]> {
	const elements = readFact(config, ['options', 'elements'], isContainer);
	if (!elements.known) return elements.reason === 'unset' ? known([], elements.path) : elements;
	const entries = Object.keys(elements.value).map((key) => ({
		entry: ownDataProperty(elements.value, key),
		path: formatPath(['options', 'elements', key])
	}));
	const hidden = entries.find(({ entry }) => !entry.found);
	if (hidden !== undefined) return unknown(hidden.path, 'accessor');
	return known(
		entries.map(({ entry, path }) => ({ value: entry.found ? entry.value : undefined, path })),
		elements.path
	);
}

/**
 * Whether the config defines a colour anywhere: in a dataset, the chart options or an element's
 * options. Then the Colors plugin stays out (`if (!options.forceOverride && containsColorDefenition)`,
 * dist/chart.js:7428), registered or not, and an uncoloured dataset takes Chart.js's own colour.
 */
function colorsDefined(config: unknown, datasets: Listed<Item>): Fact<boolean> {
	if (!datasets.known) return unknown(datasets.path, datasets.reason);
	const options = readFact(config, ['options'], isContainer);
	if (!options.known && options.reason !== 'unset') return options;
	const elements = elementsOf(config);
	if (!elements.known) return elements;
	const holders = [
		...datasets.items,
		{ value: options.known ? options.value : undefined, path: '$.options' },
		...elements.value
	];
	return holders.map(({ value, path }) => defines(value, path)).find((fact) => !fact.known || fact.value) ?? NONE;
}

/**
 * The colour a dataset is drawn in: its own (`borderColor` for lines, `backgroundColor` for bars and
 * points), else the options for its type, its element or the chart; else, when the config colours
 * anything, Chart.js's own `rgba(0,0,0,0.1)`. Without any colour in the config the Colors plugin
 * decides, if it is registered: not modelled. Per-point colours (arrays) are not modelled either.
 */
/**
 * Whether the Colors plugin may paint over every colour: `forceOverride` skips its test for colours in
 * the config (dist/chart.js:7428), unless the plugin is turned off. Whether it is registered is not in
 * the config, so then no dataset colour is known (K7). Undefined when it cannot override them.
 */
function forcedOver(config: unknown): UnknownFact | undefined {
	const at = ['options', 'plugins', 'colors'];
	const enabled = readFact(config, [...at, 'enabled'], isSet);
	if (enabled.known && enabled.value === false) return undefined;
	const force = readFact(config, [...at, 'forceOverride'], isSet);
	if (!force.known) return force.reason === 'unset' ? undefined : force;
	return force.value === false || force.value === undefined || force.value === null
		? undefined
		: unknown(force.path, 'unmodelled');
}

export function colorOf(config: unknown, item: Item, type: Fact<string>, datasets: Listed<Item>): Fact<string> {
	if (!type.known) return unknown(`${item.path}.backgroundColor`, type.reason);
	const forced = forcedOver(config);
	if (forced !== undefined) return unknown(`${item.path}.backgroundColor`, forced.reason);
	const by = COLORED_BY[type.value];
	if (by === undefined) return unknown(`${item.path}.backgroundColor`, 'unmodelled');
	const at = (path: readonly PathSegment[]): Fact<unknown> => readFact(config, [...path, by.key], isSet);
	const own = firstSet([
		at(item.segments),
		at(['options', 'datasets', type.value]),
		at(['options', 'elements', by.element]),
		at(['options'])
	]);
	if (own.known) return typeof own.value === 'string' ? (own as Fact<string>) : unknown(own.path, 'unmodelled');
	if (own.reason !== 'unset') return own;
	const defined = colorsDefined(config, datasets);
	const path = formatPath([...item.segments, by.key]);
	if (!defined.known) return unknown(path, defined.reason);
	return defined.value
		? { known: true, value: 'rgba(0,0,0,0.1)', path, source: 'default', pointer: DEFAULT[by.key] }
		: unknown(path, 'unmodelled');
}
