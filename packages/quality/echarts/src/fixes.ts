import { type Current, currentAt, type Remedies, type Remedy } from '@chartguard/quality-core';

const ONE_SECOND = 1000;
const LIMIT = 5000;
/** One run of a lines effect lasts `effect.period` seconds (default 4, dist/echarts.js:69478) unless `constantSpeed` sets it. */
const PERIOD_LIMIT = 5;

const numberOf = (now: Current): number | undefined =>
	now.set && typeof now.value === 'number' ? now.value : undefined;
const unsetOr = (now: Current, value: unknown): boolean => !now.set || now.value === value;

/** Whether one run of the lines effect whose `loop` is at `path` is known to last at most five seconds. */
function shortRun(config: unknown, path: string): boolean {
	const effect = path.slice(0, -'.loop'.length);
	const [period, speed] = [currentAt(config, `${effect}.period`), currentAt(config, `${effect}.constantSpeed`)];
	const fixedSpeed = speed !== undefined && (!speed.set || speed.value === 0);
	const shortPeriod =
		period !== undefined && (!period.set || (typeof period.value === 'number' && period.value <= PERIOD_LIMIT));
	return fixedSpeed && shortPeriod;
}

function motionRemedy(now: Current, path: string, config: unknown): Remedy | undefined {
	if (path.endsWith('.showEffectOn') && unsetOr(now, 'render'))
		return {
			value: 'emphasis',
			effect: 'The ripple plays only while the pointer is on a point, not from the first render on.'
		};
	if (path.endsWith('.effect.loop') && unsetOr(now, true) && shortRun(config, path))
		return { value: false, effect: 'The lines effect runs once instead of forever.' };
	const value = numberOf(now);
	return path.endsWith('animationDuration') && value !== undefined && value > LIMIT
		? { value: ONE_SECOND, effect: 'The animation lasts one second instead of more than five.' }
		: undefined;
}

/** ECharts remedies (CG-05-06), each verified by the review before it is offered. */
export const REMEDIES: Remedies = {
	'bar-baseline': (now) => {
		const value = numberOf(now);
		if ((value !== undefined && value !== 0) || (now.set && now.value === 'dataMin'))
			return { value: 0, effect: 'The bars grow from zero again, so their lengths are proportional to their values.' };
		return now.set && now.value === true
			? { value: false, effect: 'The value axis includes zero again (`scale: false`), so the bars grow from it.' }
			: undefined;
	},
	'bar-log-scale': (now) =>
		now.set && now.value === 'log'
			? {
					value: 'value',
					effect:
						'The value axis is linear, so bar lengths encode the values; very small values may become hard to see.'
				}
			: undefined,
	'reversed-value-axis': (now) =>
		now.set && now.value === true
			? { value: false, effect: 'Larger values are drawn higher (or further right) again.' }
			: undefined,
	'data-not-described': (now, path) =>
		path.endsWith('.enabled') && unsetOr(now, false)
			? { value: true, effect: 'ECharts describes the chart and its data to assistive technology (`aria`).' }
			: undefined,
	'long-motion': motionRemedy
};
