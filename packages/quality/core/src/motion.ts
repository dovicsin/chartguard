import { rule, SOURCES } from './catalog.js';

/** The motion rules (CG-05-04 part 7). */

/** WCAG 2.2 SC 2.2.2: moving content that starts by itself and lasts longer than this needs a way to pause it. */
const LIMIT = 5000;

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
		title: 'Motion that runs on by itself',
		rationale:
			'Motion that starts by itself and lasts longer than five seconds distracts readers who need to concentrate and can harm people with vestibular disorders; without a way to pause it, they cannot read the rest of the page.',
		evidence: [SOURCES.wcag22Pause],
		limits: [
			'A control the page gives to pause or stop the chart meets the criterion; the config does not show it. Declaring it (`context.pausesMotion: true`) suppresses the finding.',
			"None of the pinned runtimes follows the user's reduced-motion preference: short animations are not reported, and the preference is left to the page.",
			'Only the motion when the chart is drawn is checked, not the animations of later updates.'
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
		if (longest.known && longest.value > LIMIT)
			return [
				report(
					longest.path,
					`This animation runs for ${String(longest.value / 1000)} s: keep motion that starts by itself under five seconds.`
				)
			];
		return [];
	}
);
