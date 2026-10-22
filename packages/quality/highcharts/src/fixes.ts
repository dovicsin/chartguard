import type { Current, Remedies } from '@chartguard/quality-core';

const ONE_SECOND = 1000;
const LIMIT = 5000;

const numberOf = (now: Current): number | undefined =>
	now.set && typeof now.value === 'number' ? now.value : undefined;

/** Highcharts remedies (CG-05-06), each verified by the review before it is offered. */
export const REMEDIES: Remedies = {
	'bar-baseline': (now) => {
		const value = numberOf(now);
		return value !== undefined && value !== 0
			? { value: 0, effect: 'The bars grow from zero again, so their lengths are proportional to their values.' }
			: undefined;
	},
	'bar-log-scale': (now) =>
		now.set && now.value === 'logarithmic'
			? {
					value: 'linear',
					effect:
						'The value axis is linear, so bar lengths encode the values; very small values may become hard to see.'
				}
			: undefined,
	'reversed-value-axis': (now) =>
		now.set && now.value === true
			? { value: false, effect: 'Larger values are drawn higher (or further right) again.' }
			: undefined,
	'data-not-described': (now) =>
		now.set && now.value === false
			? {
					value: true,
					effect:
						'Highcharts labels the chart and its points for assistive technology (needs the accessibility module loaded).'
				}
			: undefined,
	'keyboard-disabled': (now) =>
		now.set && now.value === false
			? {
					value: true,
					effect: 'Keyboard users can reach the points, legend and menus again (needs the accessibility module loaded).'
				}
			: undefined,
	// A long animation is decided by a `duration` the config sets (objects merge over the ones below them).
	'long-motion': (now, path) => {
		const value = numberOf(now);
		return path.endsWith('.duration') && value !== undefined && value > LIMIT
			? { value: ONE_SECOND, effect: 'The series animate for one second instead of more than five.' }
			: undefined;
	},
	'percent-without-unit': (now, path) =>
		path.endsWith('.labels.format') && !now.set
			? { value: '{value}%', effect: 'The tick labels show the shares with a percent sign.' }
			: undefined
};
