import {
	type Default,
	type Fact,
	formatPath,
	type Item,
	known,
	type KnownFact,
	type Listed,
	type MotionSemantics,
	readFact,
	unknown
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined;
/** A series animates for 1000 ms by default; `animation: true` or an object without `duration` means 500 (`animObject`). */
const SERIES: Default<number> = { value: 1000, pointer: 'highcharts@13.1.1 highcharts.src.js:30251 duration: 1000' };
const ANIM_OBJECT = 'highcharts@13.1.1 highcharts.src.js:8842 merge({ duration: 500, defer: 0 }, animation) :';
const ANIM_TRUE = 'highcharts@13.1.1 highcharts.src.js:8843 { duration: animation ? 500 : 0, defer: 0 };';

const isString = (value: unknown): value is string => typeof value === 'string';

/** A series' type, for its `plotOptions`: its own, else the chart's, else line. */
function typeName(config: unknown, item: Item): string {
	const own = readFact(config, [...item.segments, 'type'], isString);
	if (own.known) return own.value;
	const chart = readFact(config, ['chart', 'type'], isString);
	return chart.known ? chart.value : 'line';
}

const booleanDuration = (value: boolean, path: string): Fact<number> =>
	value ? { known: true, value: 500, path, source: 'default', pointer: ANIM_TRUE } : known(0, path);
const objectDefault = (path: string): Fact<number> => ({
	known: true,
	value: 500,
	path,
	source: 'default',
	pointer: ANIM_OBJECT
});

/** An object `animation`'s own `duration`, or undefined when it has none (it merges with the scopes below). */
function durationOf(animation: KnownFact<unknown>): Fact<number> | undefined {
	const at = `${animation.path}.duration`;
	const duration = readFact(animation.value, ['duration'], isSet);
	if (duration.known) return typeof duration.value === 'number' ? known(duration.value, at) : unknown(at, 'shape');
	return duration.reason === 'unset' ? undefined : unknown(at, duration.reason);
}

/**
 * A series' initial animation, as its options are merged (series over the options for its type over
 * those for every series over the type's default `{ duration: 1000 }`): the highest boolean decides
 * (`true` 500 ms, `false` none), unless an object above it merges over it and has no `duration` (then
 * 500 ms, `animObject`); the highest object `duration` decides; nothing set keeps 1000 ms.
 */
function seriesDuration(config: unknown, item: Item): Fact<number> {
	const scopes = [item.segments, ['plotOptions', typeName(config, item)], ['plotOptions', 'series']];
	let overObject: string | undefined;
	for (const scope of scopes) {
		const animation = readFact(config, [...scope, 'animation'], isSet);
		if (!animation.known) {
			if (animation.reason !== 'unset') return animation;
			continue;
		}
		if (typeof animation.value === 'boolean')
			return overObject === undefined ? booleanDuration(animation.value, animation.path) : objectDefault(overObject);
		const duration = durationOf(animation);
		if (duration !== undefined) return duration;
		overObject ??= `${animation.path}.duration`;
	}
	return {
		known: true,
		value: SERIES.value,
		path: overObject ?? formatPath([...item.segments, 'animation']),
		source: 'default',
		pointer: SERIES.pointer
	};
}

/**
 * The motion Highcharts starts when it draws the chart: no built-in animation loops (`endless` does
 * not apply); the longest is the longest series animation (`chart.animation` animates updates only).
 */
export function motionOf(config: unknown, series: Listed<Item>): MotionSemantics {
	const endless = unknown('$.series', 'inapplicable');
	if (!series.known) return { endless, longest: series };
	const durations = series.items.map((item) => seriesDuration(config, item));
	const unreadable = durations.find((fact) => !fact.known);
	if (unreadable !== undefined) return { endless, longest: unreadable };
	const [first, ...rest] = durations;
	const longest = rest.reduce<Fact<number>>(
		(max, fact) => (fact.known && max.known && fact.value > max.value ? fact : max),
		first ?? known(0, '$.series')
	);
	return { endless, longest };
}
