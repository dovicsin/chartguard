import {
	type Default,
	type Fact,
	type Item,
	known,
	type Listed,
	type MotionSemantics,
	readFact,
	unknown
} from '@chartguard/quality-core';

const isSet = (value: unknown): value is unknown => value !== undefined;
const isString = (value: unknown): value is string => typeof value === 'string';
const DURATION: Default<number> = {
	value: 1000,
	pointer: 'echarts@6.1.0 dist/echarts.js:19046 animationDuration: 1000,'
};
/** An effectScatter ripples from the first render, whatever `animation` says (dist/echarts.js:68353). */
const RIPPLE: Default<string> = {
	value: 'render',
	pointer: "echarts@6.1.0 dist/echarts.js:68455 showEffectOn: 'render',"
};
const EFFECT_LOOP: Default<boolean> = { value: true, pointer: 'echarts@6.1.0 dist/echarts.js:69482 loop: true,' };

const unread = (fact: Fact<unknown>): boolean => !fact.known && fact.reason !== 'unset';

/** Whether a series keeps moving: an effectScatter rippling on render, a lines series with a looping effect. */
function seriesEndless(config: unknown, item: Item): Fact<boolean> {
	const type = readFact(config, [...item.segments, 'type'], isString);
	if (!type.known) return unknown(item.path, type.reason);
	if (type.value === 'effectScatter') {
		const on = readFact(config, [...item.segments, 'showEffectOn'], isString, RIPPLE);
		return on.known ? { ...on, value: on.value === 'render' } : on;
	}
	if (type.value !== 'lines') return known(false, item.path);
	const show = readFact(
		config,
		[...item.segments, 'effect', 'show'],
		(value): value is boolean => typeof value === 'boolean'
	);
	if (!show.known) return show.reason === 'unset' ? known(false, show.path) : show;
	const loop = readFact(
		config,
		[...item.segments, 'effect', 'loop'],
		(value): value is boolean => typeof value === 'boolean',
		EFFECT_LOOP
	);
	return loop.known ? { ...loop, value: show.value && loop.value } : loop;
}

/** The longest initial animation: the option's `animationDuration` (default 1000 ms) or a series' own; none with `animation: false`. */
function longestOf(config: unknown, items: readonly Item[]): Fact<number> {
	const animation = readFact(config, ['animation'], isSet);
	if (animation.known && animation.value === false) return { ...animation, value: 0 };
	const durations = [
		readFact(config, ['animationDuration'], isSet, DURATION),
		...items.map((item) => readFact(config, [...item.segments, 'animationDuration'], isSet))
	];
	const unreadable = [animation, ...durations].find(
		(fact) => unread(fact) || (fact.known && typeof fact.value === 'function')
	);
	if (unreadable !== undefined) return unknown(unreadable.path, unreadable.known ? 'dynamic' : unreadable.reason);
	const numbers = durations.filter(
		(fact): fact is Fact<number> & { known: true } => fact.known && typeof fact.value === 'number'
	);
	return numbers.reduce((max, fact) => (fact.value > max.value ? fact : max), known(0, '$.animationDuration'));
}

/** The motion echarts starts when it draws the chart. */
export function motionOf(config: unknown, series: Listed<Item>): MotionSemantics {
	if (!series.known) return { endless: series, longest: series };
	const endless = series.items.map((item) => seriesEndless(config, item));
	const moving = endless.find((fact) => !fact.known || fact.value);
	return { endless: moving ?? known(false, series.path), longest: longestOf(config, series.items) };
}
