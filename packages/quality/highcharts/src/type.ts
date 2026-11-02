import {
	type Default,
	type Fact,
	firstSet,
	isString,
	type Item,
	type PathSegment,
	readFact,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

const CHART_TYPE: Default<string> = {
	value: 'line',
	pointer: "highcharts@13.1.1 highcharts.src.js:1191 type: 'line',"
};

/**
 * A series' type: its own, else the chart's (`Chart#initSeries`: `options.type || optionsChart.type`),
 * else line. An own type that cannot be read (a getter, another shape) leaves it unknown: the chart's
 * is not a guess at it. The one resolver every reader of a series' type uses.
 */
export function seriesType(config: unknown, item: Item): Fact<string> {
	const own = readFact(config, [...item.segments, 'type'], isString);
	return own.known || own.reason !== 'unset' ? own : readFact(config, ['chart', 'type'], isString, CHART_TYPE);
}

/**
 * The scopes a series option merges from, most specific first: the series, the options for its type,
 * those for every series. When the type is not known, which type's options apply is not known: that
 * scope is the type's unknown fact, which decides before the scopes below it.
 */
function seriesScopes(item: Item, type: Fact<string>): readonly (readonly PathSegment[] | UnknownFact)[] {
	const typed = type.known
		? ['plotOptions', type.value]
		: unknown(type.path, type.reason === 'unset' ? 'unmodelled' : type.reason);
	return [item.segments, typed, ['plotOptions', 'series']];
}

/** Each scope's fact for `name`: read from the config, or the unknown type scope as it is. */
export function scopedFacts<T>(
	config: unknown,
	item: Item,
	type: Fact<string>,
	{ name, is }: Pick<SeriesOption<T>, 'name' | 'is'>
): Fact<T>[] {
	return seriesScopes(item, type).map((scope) => ('known' in scope ? scope : readFact(config, [...scope, name], is)));
}

/** A series option: its name, the values read, and the runtime default. */
export interface SeriesOption<T> {
	readonly name: string;
	readonly is: (value: unknown) => value is T;
	readonly fallback?: Default<T>;
}

/** An option of a series as its options merge: the first scope that sets it (`firstSet`), else the default. */
export function seriesOption<T>(
	config: unknown,
	item: Item,
	type: Fact<string>,
	{ name, is, fallback }: SeriesOption<T>
): Fact<T> {
	return firstSet(scopedFacts(config, item, type, { name, is }), fallback);
}
