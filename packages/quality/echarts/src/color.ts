import {
	type Fact,
	formatPath,
	type Item,
	type KnownFact,
	type Listed,
	readFact,
	unknown
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined;
const THEME_POINTER =
	"echarts@6.1.0 dist/echarts.js:18872 theme: ['#5070dd', '#b6d634', '#505372', '#ff994d', '#0ca8df', '#ffd10a', '#fb628b', '#785db0', '#3fbe95'],";
const THEME = ['#5070dd', '#b6d634', '#505372', '#ff994d', '#0ca8df', '#ffd10a', '#fb628b', '#785db0', '#3fbe95'];

/** The global palette: the option's `color` (a list, or one colour), else the theme's. */
function paletteOf(config: unknown): Fact<readonly KnownFact<string>[]> {
	const color = readFact(config, ['color'], isSet);
	if (!color.known && color.reason !== 'unset') return color;
	if (!color.known)
		return {
			known: true,
			value: THEME.map((value) => ({ known: true, value, path: '$.color', source: 'default', pointer: THEME_POINTER })),
			path: '$.color',
			source: 'default',
			pointer: THEME_POINTER
		};
	const list = Array.isArray(color.value) ? (color.value as unknown[]) : [color.value];
	if (!list.every((entry) => typeof entry === 'string') || list.length === 0) return unknown(color.path, 'unmodelled');
	const at = (index: number): string => (Array.isArray(color.value) ? formatPath(['color', index]) : color.path);
	return {
		...color,
		value: list.map((value, index) => ({ known: true, value, path: at(index), source: 'config' }))
	};
}

/**
 * Where a series type keeps the colour the palette would give it (`visualStyleAccessPath`, and the key
 * its `visualDrawType` maps to): `itemStyle.color` by default; a lines or parallel series' `lineStyle`
 * (dist/echarts.js:69261, :64299), a boxplot's border (`visualDrawType = 'stroke'`, :67243) (K8).
 */
const OWN_COLOR: Readonly<Record<string, readonly string[]>> = {
	lines: ['lineStyle', 'color'],
	parallel: ['lineStyle', 'color'],
	boxplot: ['itemStyle', 'borderColor']
};

/** A series' own colour, where its type keeps it; a type that cannot be read is not known. */
function ownColor(config: unknown, item: Item): Fact<unknown> {
	const type = readFact(config, [...item.segments, 'type'], isString);
	if (!type.known)
		return unknown(
			formatPath([...item.segments, 'itemStyle', 'color']),
			type.reason === 'unset' ? 'unmodelled' : type.reason
		);
	return readFact(config, [...item.segments, ...(OWN_COLOR[type.value] ?? ['itemStyle', 'color'])], isSet);
}

/** A series' own palette (`series.color`, a list or one colour): its first colour. */
function seriesPalette(config: unknown, item: Item): Fact<string> {
	const color = readFact(config, [...item.segments, 'color'], isSet);
	if (!color.known) return color;
	const first = Array.isArray(color.value) ? (color.value as unknown[])[0] : color.value;
	const path = Array.isArray(color.value) ? formatPath([...item.segments, 'color', 0]) : color.path;
	return typeof first === 'string'
		? { known: true, value: first, path, source: 'config' }
		: unknown(path, 'unmodelled');
}

/** The global palette as echarts draws from it: one colour per series name, in order, wrapping around. */
class Palette {
	private next = 0;
	private lost: boolean;
	private readonly byName = new Map<string, KnownFact<string>>();

	constructor(private readonly colors: Fact<readonly KnownFact<string>[]>) {
		this.lost = !colors.known;
	}

	/** A series whose draw cannot be known: every palette colour after it is unknown. */
	lose(): void {
		this.lost = true;
	}

	draw(name: string, at: string): Fact<string> {
		if (this.lost || !this.colors.known || this.colors.value.length === 0) return unknown(at, 'unmodelled');
		const drawn = this.byName.get(name) ?? this.colors.value[this.next++ % this.colors.value.length];
		if (drawn === undefined) return unknown(at, 'unmodelled');
		this.byName.set(name, drawn);
		// A built-in palette colour is the series' own default: it is set where the series would set its own.
		return drawn.source === 'default' ? { ...drawn, path: at } : drawn;
	}
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** Whether a fact could be set but cannot be read (a getter): the palette's order is lost after it. */
const unreadable = (fact: Fact<unknown>): boolean => !fact.known && fact.reason !== 'unset';

/** A colour of the series' own that decides it without the palette, or undefined when the palette draws. */
function ownDecides(own: Fact<unknown>): Fact<string> | undefined {
	if (!own.known || typeof own.value === 'function' || own.value === 'auto') return undefined;
	return isString(own.value) ? { ...own, value: own.value } : unknown(own.path, 'unmodelled');
}

/** One series' colour; a series without a colour of its own, or with a function or `'auto'`, draws from `palette`. */
function colorOf(config: unknown, item: Item, index: number, palette: Palette): Fact<string> {
	const own = ownColor(config, item);
	const named = readFact(config, [...item.segments, 'name'], isString);
	if (unreadable(own) || unreadable(named)) palette.lose();
	const decided = ownDecides(own);
	if (decided !== undefined) return decided;
	const mine = seriesPalette(config, item);
	if (mine.known || mine.reason !== 'unset') return mine;
	const drawn = palette.draw(named.known ? named.value : `series\u0000${String(index)}`, own.path);
	// A function colours each item itself, after drawing from the palette; `'auto'` takes the palette colour.
	return own.known && typeof own.value === 'function' ? unknown(own.path, 'dynamic') : drawn;
}

/**
 * The colour each series is drawn in, as echarts' series style task assigns it (dist/echarts.js:25384):
 * its own `itemStyle.color`; else its own palette (`series.color`); else the global palette, one colour per
 * series name in order of first use (a repeated name reuses its colour, `paletteNameMap`), wrapping
 * around. Pie series are coloured per item: not modelled, though they draw from the palette too.
 */
export function seriesColors(config: unknown, items: Listed<Item>): Fact<string>[] {
	if (!items.known) return [];
	const palette = new Palette(paletteOf(config));
	return items.items.map((item, index) => {
		const color = colorOf(config, item, index, palette);
		const type = readFact(config, [...item.segments, 'type'], isString);
		if (!type.known || type.value === 'pie') return unknown(color.path, type.known ? 'unmodelled' : type.reason);
		// A line's `lineStyle.color` repaints its line only: the series is then two colours.
		const stroke = readFact(config, [...item.segments, 'lineStyle', 'color'], isSet);
		return type.value === 'line' && (stroke.known || stroke.reason !== 'unset')
			? unknown(stroke.path, 'unmodelled')
			: color;
	});
}
