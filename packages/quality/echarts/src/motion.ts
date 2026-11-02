import {
	type Default,
	type Fact,
	firstSet,
	formatPath,
	holds,
	isBoolean,
	isDefined,
	isString,
	type Item,
	known,
	type KnownFact,
	type Listed,
	type MotionSemantics,
	readFact,
	unknown,
	type UnknownFact,
	unreadable
} from '@chartguard/quality-core';

const DURATION: Default<unknown> = {
	value: 1000,
	pointer: 'echarts@6.1.0 dist/echarts.js:19046 animationDuration: 1000, [in var globalDefault]'
};
const ANIMATION: Default<unknown> = {
	value: 'auto',
	pointer: "echarts@6.1.0 dist/echarts.js:19045 animation: 'auto', [in var globalDefault]"
};
/**
 * A series with more data than its threshold does not animate:
 * 'echarts@6.1.0 dist/echarts.js:24708 if (this.getData().count() > this.getShallow('animationThreshold')) {'
 */
const THRESHOLD: Default<unknown> = {
	value: 2000,
	pointer: 'echarts@6.1.0 dist/echarts.js:19050 animationThreshold: 2000,'
};
/** An effectScatter ripples from the first render, whatever `animation` says (dist/echarts.js:68353). */
const RIPPLE: Default<string> = {
	value: 'render',
	pointer: "echarts@6.1.0 dist/echarts.js:68455 showEffectOn: 'render',"
};
const EFFECT_LOOP: Default<boolean> = {
	value: true,
	pointer: 'echarts@6.1.0 dist/echarts.js:69482 loop: true, [in LinesSeriesModel.defaultOption]'
};
/** Series types whose data count (`getData().count()`) is the length of their `data`; others (trees, graphs, maps) are not read. */
const ROWS = new Set([
	'line',
	'bar',
	'pictorialBar',
	'scatter',
	'effectScatter',
	'pie',
	'funnel',
	'gauge',
	'candlestick',
	'boxplot',
	'heatmap',
	'lines',
	'parallel',
	'custom'
]);

/** Whether a series keeps moving: an effectScatter rippling on render, a lines series with a looping effect. */
function seriesEndless(config: unknown, item: Item): Fact<boolean> {
	const type = readFact(config, [...item.segments, 'type'], isString);
	if (!type.known) return unknown(item.path, type.reason);
	if (type.value === 'effectScatter') {
		const on = readFact(config, [...item.segments, 'showEffectOn'], isString, RIPPLE);
		return on.known ? { ...on, value: on.value === 'render' } : on;
	}
	if (type.value !== 'lines') return known(false, item.path);
	const show = readFact(config, [...item.segments, 'effect', 'show'], isBoolean);
	if (!show.known) return show.reason === 'unset' ? known(false, show.path) : show;
	const loop = readFact(config, [...item.segments, 'effect', 'loop'], isBoolean, EFFECT_LOOP);
	return loop.known ? { ...loop, value: show.value && loop.value } : loop;
}

/** `getShallow`: the series' own value, else the option's (a `null` falls through, `val == null`), else the default. */
function shallow(config: unknown, item: Item, key: string, fallback: Default<unknown>): Fact<unknown> {
	const scopes = [[...item.segments, key], [key]].map((path) => {
		const fact = readFact(config, path, isDefined);
		return fact.known && fact.value === null ? unknown(fact.path, 'unset') : fact;
	});
	return firstSet(scopes, fallback);
}

/** A series' data count, where it is the length of its `data`; from a dataset or of another shape it is not read. */
function countOf(config: unknown, item: Item): Fact<number> {
	const at = formatPath([...item.segments, 'data']);
	const type = readFact(config, [...item.segments, 'type'], isString);
	if (!type.known) return unknown(at, type.reason);
	if (!ROWS.has(type.value)) return unknown(at, 'unmodelled');
	const data = readFact(config, [...item.segments, 'data'], Array.isArray);
	if (data.known) return known(data.value.length, at);
	if (data.reason !== 'unset') return data;
	return holds(config, ['dataset']) ? unknown(at, 'unmodelled') : known(0, at);
}

/**
 * Whether a series animates when drawn (`SeriesModel#isAnimationEnabled`): its `animation` is truthy
 * and its data count is not above its `animationThreshold`. A large series (`large`) may be drawn
 * without animation: not modelled.
 */
function animates(config: unknown, item: Item): Fact<boolean> {
	const animation = shallow(config, item, 'animation', ANIMATION);
	if (!animation.known) return animation;
	if (typeof animation.value === 'function') return unknown(animation.path, 'dynamic');
	// `!!animationEnabled`: any falsy value turns it off.
	if (!Boolean(animation.value)) return { ...animation, value: false };
	const large = readFact(config, [...item.segments, 'large'], isDefined);
	if (unreadable(large) || (large.known && large.value !== false)) return unknown(large.path, 'unmodelled');
	const threshold = shallow(config, item, 'animationThreshold', THRESHOLD);
	if (!threshold.known) return threshold;
	if (typeof threshold.value !== 'number') return unknown(threshold.path, 'shape');
	const count = countOf(config, item);
	return count.known ? { ...count, value: count.value <= threshold.value } : count;
}

/** A series' animation duration: its own `animationDuration`, else the option's, else 1000 ms. */
function durationOf(config: unknown, item: Item): Fact<number> {
	const duration = shallow(config, item, 'animationDuration', DURATION);
	if (!duration.known) return duration;
	if (typeof duration.value === 'function') return unknown(duration.path, 'dynamic');
	return typeof duration.value === 'number' ? (duration as KnownFact<number>) : unknown(duration.path, 'shape');
}

/**
 * The longest initial series animation. A series whose animating is not known matters only when it
 * would last longer than every series known to animate: then the longest is unknown.
 */
function longestOf(config: unknown, series: { path: string; items: readonly Item[] }): Fact<number> {
	let longest: KnownFact<number> = known(0, series.path);
	const undecided: { animates: UnknownFact; duration: KnownFact<number> }[] = [];
	for (const item of series.items) {
		const [moving, duration] = [animates(config, item), durationOf(config, item)];
		if (moving.known && !moving.value) continue;
		if (!duration.known) return duration;
		if (!moving.known) undecided.push({ animates: moving, duration });
		else if (duration.value > longest.value) longest = duration;
	}
	return undecided.find(({ duration }) => duration.value > longest.value)?.animates ?? longest;
}

/** The motion echarts starts when it draws the chart. */
export function motionOf(config: unknown, series: Listed<Item>): MotionSemantics {
	if (!series.known) return { endless: series, longest: series };
	const endless = series.items.map((item) => seriesEndless(config, item));
	const moving = endless.find((fact) => !fact.known || fact.value);
	return { endless: moving ?? known(false, series.path), longest: longestOf(config, series) };
}
