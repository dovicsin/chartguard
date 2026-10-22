import type { Current, Remedies, Remedy } from '@chartguard/quality-core';

/** The longest animation the long-motion fix leaves: one second. */
const ONE_SECOND = 1000;
const LIMIT = 5000;

const numberOf = (now: Current): number | undefined =>
	now.set && typeof now.value === 'number' ? now.value : undefined;

/** Chart.js remedies (CG-05-06), each verified by the review before it is offered. */
export const REMEDIES: Remedies = {
	'bar-baseline': (now): Remedy | undefined => {
		const value = numberOf(now);
		if (value !== undefined && value !== 0)
			return { value: 0, effect: 'The bars grow from zero again, so their lengths are proportional to their values.' };
		return now.set && now.value === false
			? { value: true, effect: 'The value scale includes zero again (`beginAtZero: true`), so the bars grow from it.' }
			: undefined;
	},
	'bar-log-scale': (now) =>
		now.set && now.value === 'logarithmic'
			? {
					value: 'linear',
					effect:
						'The value scale is linear, so bar lengths encode the values; very small values may become hard to see.'
				}
			: undefined,
	'reversed-value-axis': (now) =>
		now.set && now.value === true
			? { value: false, effect: 'Larger values are drawn higher (or further right) again.' }
			: undefined,
	'long-motion': (now, path) => {
		if (path.endsWith('.loop') && now.set && now.value === true)
			return { value: false, effect: 'The animation runs once instead of forever.' };
		const value = numberOf(now);
		return path.endsWith('.duration') && value !== undefined && value > LIMIT
			? { value: ONE_SECOND, effect: 'The animation lasts one second instead of more than five.' }
			: undefined;
	}
};
