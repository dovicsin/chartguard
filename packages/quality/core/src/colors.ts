import { rule, SOURCES } from './catalog.js';
import { colorKey } from './color.js';
import { valueOf } from './facts.js';
import { CARTESIAN } from './measure.js';

/** The colour rules (CG-05-04 part 4). */

export const sameColorSeries = rule(
	{
		id: 'same-color-series',
		code: 'VIS_SAME_COLOR_SERIES',
		severity: 'warning',
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
