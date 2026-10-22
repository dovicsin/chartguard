import { rule, SOURCES } from './catalog.js';
import type { Shades } from './chart.js';
import { colorKey, contrastRatio } from './color.js';
import { valueOf } from './facts.js';
import { CARTESIAN } from './measure.js';

/** The colour rules (CG-05-04 part 4). */

export const sameColorSeries = rule(
	{
		id: 'same-color-series',
		code: 'VIS_SAME_COLOR_SERIES',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		title: 'Two series drawn in the same colour',
		rationale:
			'Colour is how readers tell series apart and match them to the legend. Two series in one colour cannot be told apart; it happens when an explicit colour is repeated, when Chart.js falls back to its one default grey, or when more series than palette colours wrap around the palette.',
		evidence: [SOURCES.ware2012],
		limits: [
			'Only the colours the semantics know are compared: per-point colours, gradients and Chart.js datasets coloured by its Colors plugin (which depends on what is registered) are not.',
			'Two forms of one colour are recognised as the same only for hex and rgb() notations; series told apart in another way (line dash, markers, labels on the series) are still reported.'
		]
	},
	(chart, report) => {
		if (!chart.series.known) return [];
		const seen = new Set<string>();
		return chart.series.items.flatMap(({ kind, color }) => {
			const [drawn, drawnKind] = [valueOf(color), valueOf(kind)];
			if (drawn === undefined || drawnKind === undefined || !CARTESIAN.includes(drawnKind)) return [];
			const key = colorKey(drawn);
			if (!seen.has(key)) return (seen.add(key), []);
			return [
				report(
					color.path,
					'This series is drawn in the same colour as an earlier one: readers cannot tell them apart; give it its own colour.'
				)
			];
		});
	}
);

/** WCAG 2.2 SC 1.4.11: graphical objects that carry information need 3:1 against adjacent colours. */
const MINIMUM = 3;

/** Each scheme where both shades are known and their contrast is below the minimum, with its ratio. */
function lowContrast(front: Shades, back: Shades): string[] {
	return (['light', 'dark'] as const).flatMap((scheme) => {
		const [series, background] = [front[scheme], back[scheme]];
		if (series === undefined || background === undefined) return [];
		const ratio = contrastRatio(series.value, background.value);
		return ratio !== undefined && ratio < MINIMUM ? [`${ratio.toFixed(2)}:1 in the ${scheme} scheme`] : [];
	});
}

export const lowContrastSeries = rule(
	{
		id: 'low-contrast-series',
		code: 'VIS_LOW_CONTRAST_SERIES',
		severity: 'info',
		impact: 'risks',
		context: [
			{
				fact: 'background',
				effect: 'supplies',
				note: 'A chart that draws no background of its own (a Chart.js canvas, ECharts without `backgroundColor`, a transparent Highcharts background) shows its series on the page: the page background the caller declares is the one they are measured against.'
			}
		],
		title: 'A series with low contrast against its background',
		rationale:
			"A line, bar or point that carries data needs a contrast of at least 3:1 against what it is drawn on, or readers with low vision lose it. Translucent colours are judged as drawn, over the background; charts that follow the user's light or dark scheme are judged in each.",
		evidence: [SOURCES.wcag22Contrast],
		limits: [
			'Only the chart background is compared, not gridlines or other series. A page showing through (Chart.js canvases, ECharts without `backgroundColor`, a transparent Highcharts background) is compared only when the caller declares it (`context.background`); a scheme the declaration leaves out is not compared.',
			'Information given another way (data labels, a table) meets the criterion without the contrast; several default palettes have colours below 3:1 on white, so the finding is a note.',
			'Only hex and rgb() colours are compared.'
		]
	},
	({ series, background }, report) => {
		if (!series.known || !background.known) return [];
		return series.items.flatMap(({ kind, shades }) => {
			const drawnKind = valueOf(kind);
			if (!shades.known || drawnKind === undefined || !CARTESIAN.includes(drawnKind)) return [];
			const low = lowContrast(shades.value, background.value);
			return low.length === 0
				? []
				: [
						report(
							shades.path,
							`This series has low contrast against the background (${low.join(', ')}; WCAG asks for 3:1).`
						)
					];
		});
	}
);
