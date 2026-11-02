import { rule, SOURCES } from './catalog.js';

/** The motion rules (CG-05-04 part 7). */

/** WCAG 2.2 SC 2.2.2: moving content that starts by itself and lasts longer than this (ms) needs a way to pause it. */
export const LONG_MOTION_MS = 5000;
/** The duration (ms) the long-motion fixes give an animation that lasts too long. */
export const SHORT_MOTION_MS = 1000;

export const longMotion = rule(
	{
		id: 'long-motion',
		code: 'VIS_LONG_MOTION',
		severity: 'warning',
		impact: 'excludes',
		context: [
			{
				fact: 'pausesMotion',
				effect: 'satisfies',
				note: '`true`: the page gives a control that pauses or stops the motion, which meets WCAG 2.2.2; the finding is suppressed.'
			}
		],
		fix: {
			offered: true,
			edit: 'Stops a loop (Chart.js `loop: false`; an ECharts ripple only on hover; an ECharts lines effect run once when one run lasts at most five seconds), or sets a duration over five seconds to one second.'
		},
		title: 'Motion that runs on by itself',
		rationale:
			'Motion that starts by itself and lasts longer than five seconds distracts readers who need to concentrate and can harm people with vestibular disorders; without a way to pause it, they cannot read the rest of the page.',
		evidence: [SOURCES.wcag22Pause],
		limits: [
			'A control the page gives to pause or stop the chart meets the criterion; the config does not show it. Declaring it (`context.pausesMotion: true`) suppresses the finding.',
			"None of the pinned runtimes follows the user's reduced-motion preference: short animations are not reported, and the preference is left to the page.",
			'Only the motion when the chart is drawn is checked, not the animations of later updates.',
			'ECharts does not animate a series with `animation: false` or with more data than its `animationThreshold`; a data count from a `dataset`, of a hierarchy or of a `large` series is unknown, and so is whether that series animates.'
		]
	},
	({ motion: { endless, longest } }, report) => {
		if (endless.known && endless.value)
			return [
				report(
					endless.path,
					'This chart keeps moving without end: give readers a way to stop it, or show the effect only on hover.'
				)
			];
		if (longest.known && longest.value > LONG_MOTION_MS)
			return [
				report(
					longest.path,
					`This animation runs for ${String(longest.value / 1000)} s: keep motion that starts by itself under five seconds.`
				)
			];
		return [];
	}
);
