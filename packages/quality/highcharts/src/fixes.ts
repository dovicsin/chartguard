import {
	currentNumber,
	type LinearScale,
	LONG_MOTION_MS,
	type Remedies,
	SHORT_MOTION_MS
} from '@chartguard/quality-core';

/** Highcharts remedies (CG-05-06), each verified by the review before it is offered. */
export const REMEDIES: Remedies = {
	'bar-baseline': (now) => {
		const value = currentNumber(now);
		return value !== undefined && value !== 0
			? { value: 0, effect: 'The bars grow from zero again, so their lengths are proportional to their values.' }
			: undefined;
	},
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
		const value = currentNumber(now);
		return path.endsWith('.duration') && value !== undefined && value > LONG_MOTION_MS
			? { value: SHORT_MOTION_MS, effect: 'The series animate for one second instead of more than five.' }
			: undefined;
	},
	'percent-without-unit': (now, path) =>
		path.endsWith('.labels.format') && !now.set
			? { value: '{value}%', effect: 'The tick labels show the shares with a percent sign.' }
			: undefined
};

/** The linear axis `bar-log-scale` proposes (CG-05-07 Q2.2: only while the bars span less than 10×). */
export const LINEAR: LinearScale = {
	log: 'logarithmic',
	linear: 'linear',
	effect: 'The value axis is linear, so bar lengths encode the values; very small values may become hard to see.'
};
