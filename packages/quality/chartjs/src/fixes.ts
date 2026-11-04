import {
	currentNumber,
	type LinearScale,
	LONG_MOTION_MS,
	type Remedies,
	type Remedy,
	SHORT_MOTION_MS
} from '@chartguard/quality-core';

/** Chart.js remedies (CG-05-06), each verified by the review before it is offered. */
export const REMEDIES: Remedies = {
	'bar-baseline': (now): Remedy | undefined => {
		const value = currentNumber(now);
		if (value !== undefined && value !== 0)
			return { value: 0, effect: 'The bars grow from zero again, so their lengths are proportional to their values.' };
		return now.set && now.value === false
			? { value: true, effect: 'The value scale includes zero again (`beginAtZero: true`), so the bars grow from it.' }
			: undefined;
	},
	'reversed-value-axis': (now) =>
		now.set && now.value === true
			? { value: false, effect: 'Larger values are drawn higher (or further right) again.' }
			: undefined,
	'long-motion': (now, path) => {
		if (path.endsWith('.loop') && now.set && now.value === true)
			return { value: false, effect: 'The animation runs once instead of forever.' };
		const value = currentNumber(now);
		return path.endsWith('.duration') && value !== undefined && value > LONG_MOTION_MS
			? { value: SHORT_MOTION_MS, effect: 'The animation lasts one second instead of more than five.' }
			: undefined;
	}
};

/** The linear scale `bar-log-scale` proposes (CG-05-07 Q2.2: only while the bars span less than 10×). */
export const LINEAR: LinearScale = {
	log: 'logarithmic',
	linear: 'linear',
	effect: 'The value scale is linear, so bar lengths encode the values; very small values may become hard to see.'
};
