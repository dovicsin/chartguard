import { isContainer, ownDataProperty } from '@chartguard/core';
import {
	type Default,
	type Fact,
	isDefined,
	type Item,
	known,
	type Listed,
	type MotionSemantics,
	readFact,
	unknown,
	unreadable
} from '@chartguard/quality-core';

const DURATION: Default<number> = {
	value: 1000,
	pointer: 'chart.js@4.6.1 dist/chunks/index.js:783 duration: 1000,'
};
const LOOP: Default<boolean> = {
	value: false,
	pointer: 'chart.js@4.6.1 dist/chunks/index.js:787 loop: undefined,'
};

const isDynamic = (fact: Fact<unknown>): boolean => fact.known && typeof fact.value === 'function';

/** The animation configs that apply: `options.animation` and each `options.animations.<name>`; undefined when one cannot be read. */
function configs(config: unknown): (readonly (string | number)[])[] | undefined {
	const animations = readFact(config, ['options', 'animations'], isContainer);
	if (unreadable(animations)) return undefined;
	const names = animations.known ? Object.keys(animations.value) : [];
	if (animations.known && names.some((name) => !ownDataProperty(animations.value, name).found)) return undefined;
	return [['options', 'animation'], ...names.map((name) => ['options', 'animations', name])];
}

/**
 * The motion Chart.js starts when it draws the chart: endless when an animation config `loop`s
 * (default `undefined`), as long as the longest `duration` (default 1000 ms); none with
 * `animation: false`. Datasets with animation options of their own are not modelled.
 */
export function motionOf(config: unknown, datasets: Listed<Item>): MotionSemantics {
	const animation = readFact(config, ['options', 'animation'], isDefined);
	if (animation.known && animation.value === false)
		return { endless: { ...animation, value: false }, longest: { ...animation, value: 0 } };
	const own = datasets.known
		? datasets.items.flatMap((item) =>
				['animation', 'animations'].map((key) => readFact(config, [...item.segments, key], isDefined))
			)
		: [];
	const scopes = configs(config);
	if (
		unreadable(animation) ||
		!datasets.known ||
		scopes === undefined ||
		own.some((fact) => fact.known || unreadable(fact))
	)
		return {
			endless: unknown('$.options.animation', 'unmodelled'),
			longest: unknown('$.options.animation', 'unmodelled')
		};
	const loops = scopes.map((scope) => readFact(config, [...scope, 'loop'], isDefined));
	const durations = scopes.map((scope, index) =>
		readFact(config, [...scope, 'duration'], isDefined, index === 0 ? DURATION : undefined)
	);
	return { endless: endlessOf(loops), longest: longestOf(durations) };
}

function endlessOf(loops: readonly Fact<unknown>[]): Fact<boolean> {
	const decided = loops.find((fact) => unreadable(fact) || isDynamic(fact) || (fact.known && fact.value === true));
	if (decided === undefined)
		return {
			known: true,
			value: false,
			path: loops[0]?.path ?? '$.options.animation.loop',
			source: 'default',
			pointer: LOOP.pointer
		};
	if (!decided.known) return decided;
	return isDynamic(decided) ? unknown(decided.path, 'dynamic') : { ...decided, value: true };
}

function longestOf(durations: readonly Fact<unknown>[]): Fact<number> {
	const undecided = durations.find((fact) => unreadable(fact) || isDynamic(fact));
	if (undecided !== undefined) return unknown(undecided.path, undecided.known ? 'dynamic' : undecided.reason);
	const numbers = durations.filter(
		(fact): fact is Fact<number> & { known: true } => fact.known && typeof fact.value === 'number'
	);
	const longest = numbers.reduce<(typeof numbers)[number] | undefined>(
		(max, fact) => (max === undefined || fact.value > max.value ? fact : max),
		undefined
	);
	return longest ?? known(0, '$.options.animation.duration');
}
