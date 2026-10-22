import {
	type Fact,
	firstSet,
	formatPath,
	type Item,
	type KnownFact,
	type Listed,
	readFact,
	unknown
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined;
const isString = (value: unknown): value is string => typeof value === 'string';
const isIndex = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const DEFAULT_COLORS =
	'highcharts@13.1.1 highcharts.src.js:4817 colors: new Array(10).fill(1).map((_, i) => `var(--highcharts-color-${i})`),';
/** Series types coloured per point by default. */
const BY_POINT = new Set(['pie']);

/** The chart's colours: its `colors`, else Highcharts' ten CSS variables. */
function colorsOf(config: unknown): Fact<readonly KnownFact<string>[]> {
	const colors = readFact(config, ['colors'], isSet);
	if (!colors.known && colors.reason !== 'unset') return colors;
	if (!colors.known) {
		const value = Array.from({ length: 10 }, (_, index): KnownFact<string> => ({
			known: true,
			value: `var(--highcharts-color-${String(index)})`,
			path: '$.colors',
			source: 'default',
			pointer: DEFAULT_COLORS
		}));
		return { known: true, value, path: '$.colors', source: 'default', pointer: DEFAULT_COLORS };
	}
	const list = colors.value;
	if (!Array.isArray(list) || list.length === 0 || !(list as unknown[]).every(isString))
		return unknown(colors.path, 'unmodelled');
	return {
		...colors,
		value: (list as string[]).map((value, index) => ({
			known: true,
			value,
			path: formatPath(['colors', index]),
			source: 'config'
		}))
	};
}

/** A series' type: its own, else the chart's, else line. */
const typeOf = (config: unknown, item: Item): Fact<string> => {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset'
		? own
		: readFact(config, ['chart', 'type'], isString, {
				value: 'line',
				pointer: "highcharts@13.1.1 highcharts.src.js:1191 type: 'line',"
			});
};

/** The chart's colour counter (`chart.colorCounter`): it moves only for series that take the next colour. */
class Cycle {
	private counter = 0;
	private lost: boolean;

	constructor(private readonly colors: Fact<readonly KnownFact<string>[]>) {
		this.lost = !colors.known;
	}

	/** A series whose draw cannot be known: every counted colour after it is unknown. */
	lose(): void {
		this.lost = true;
	}

	/** The colour at `colorIndex` (no wrap: `value = defaults[i]`), else the next one, wrapping. */
	take(index: Fact<number>, at: string): Fact<string> {
		if (this.lost || !this.colors.known) return unknown(at, 'unmodelled');
		const colors = this.colors.value;
		const color = index.known ? colors[index.value] : colors[this.counter++ % colors.length];
		if (color === undefined) return unknown(at, 'unmodelled');
		// A built-in chart colour is the series' own default: it is set where the series would set its own.
		return color.source === 'default' ? { ...color, path: at } : color;
	}
}

/** An option the series resolves through itself, the options for its type and those for every series. */
function scoped(config: unknown, item: Item, type: Fact<string>, key: string): Fact<unknown> {
	const scopes = [item.segments, ['plotOptions', type.known ? type.value : 'series'], ['plotOptions', 'series']];
	return firstSet(scopes.map((scope) => readFact(config, [...scope, key], isSet)));
}

/** Whether the series is coloured per point: `colorByPoint`, which pies default to. Undefined when unknown. */
function byPoint(config: unknown, item: Item, type: Fact<string>): boolean | undefined {
	const option = scoped(config, item, type, 'colorByPoint');
	if (option.known) return option.value === true;
	if (option.reason !== 'unset' || !type.known) return undefined;
	return BY_POINT.has(type.value);
}

function colorOf(config: unknown, item: Item, cycle: Cycle): Fact<string> {
	const type = typeOf(config, item);
	const at = formatPath([...item.segments, 'color']);
	const perPoint = byPoint(config, item, type);
	if (perPoint === true) return unknown(at, 'unmodelled');
	const own = scoped(config, item, type, 'color');
	if (own.known) return isString(own.value) ? { ...own, value: own.value } : unknown(own.path, 'unmodelled');
	if (own.reason !== 'unset' || perPoint === undefined) cycle.lose();
	return cycle.take(readFact(config, [...item.segments, 'colorIndex'], isIndex), at);
}

/**
 * The colour each series is drawn in, as `Series#getColor` and `getCyclic` assign it
 * (highcharts.src.js:33406): its `color` (from the series, the options for its type or for all series);
 * else the chart colour at its `colorIndex`; else the next chart colour, the counter moving only for
 * series that take one. Series coloured per point (pies, `colorByPoint`) take none; styled mode
 * colours through CSS classes: not modelled.
 */
export function seriesColors(config: unknown, items: Listed<Item>): Fact<string>[] {
	if (!items.known) return [];
	const styled = readFact(config, ['chart', 'styledMode'], (value): value is boolean => typeof value === 'boolean');
	const cycle = new Cycle(colorsOf(config));
	if (!styled.known ? styled.reason !== 'unset' : styled.value) cycle.lose();
	return items.items.map((item) => colorOf(config, item, cycle));
}
