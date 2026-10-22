import { rule, SOURCES } from './catalog.js';

/** The accessibility rules (CG-05-04 part 5): what assistive technology gets from the chart. */

export const dataNotDescribed = rule(
	{
		id: 'data-not-described',
		code: 'VIS_DATA_NOT_DESCRIBED',
		severity: 'warning',
		title: 'The data is not described to assistive technology',
		rationale:
			'A chart drawn as graphics gives a screen reader nothing to read unless the library labels its points or generates a description. ECharts does so only with `aria.enabled`; Highcharts only with its accessibility module enabled.',
		evidence: [SOURCES.wcag22],
		limits: [
			'The page may describe the data outside the chart (a caption, a table, an `aria-label` on the container); the config does not show it.',
			'Chart.js draws on a canvas whose text alternative is set in the page, not in the config: it is not checked.'
		]
	},
	({ access: { dataDescribed } }, report) =>
		dataDescribed.known && !dataDescribed.value
			? [
					report(
						dataDescribed.path,
						"Assistive technology gets no description of this chart's data: enable the library's accessibility support, or describe the data next to the chart."
					)
				]
			: []
);

export const keyboardDisabled = rule(
	{
		id: 'keyboard-disabled',
		code: 'VIS_KEYBOARD_DISABLED',
		severity: 'warning',
		title: 'Keyboard access turned off',
		rationale:
			"Keyboard users reach a chart's points, legend and menus only through the library's keyboard navigation. A config that turns it off leaves them with what a mouse user hovers over.",
		evidence: [SOURCES.wcag22Keyboard],
		limits: [
			'Only keyboard access the config turns off is reported; a library without keyboard navigation (ECharts, Chart.js) is not.',
			'A chart that only shows a picture, with nothing to operate, may not need keyboard access.'
		]
	},
	({ access: { keyboard } }, report) =>
		keyboard.known && keyboard.source === 'config' && !keyboard.value
			? [
					report(
						keyboard.path,
						"The config turns keyboard navigation off: keyboard users cannot reach the chart's points or legend."
					)
				]
			: []
);
