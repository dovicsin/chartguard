import { rule, SOURCES } from './catalog.js';
import { valueOf } from './facts.js';

/** The unit rules (CG-05-04 part 8). */

const PERCENT = '%';

export const percentWithoutUnit = rule(
	{
		id: 'percent-without-unit',
		code: 'VIS_PERCENT_WITHOUT_UNIT',
		severity: 'info',
		impact: 'omits',
		context: [],
		title: 'Shares shown as bare numbers',
		rationale:
			'A percent-stacked chart shows each value as its share of the stack, on an axis from 0 to 100. Without a percent sign on its tick labels or in its title, the axis reads as amounts, and readers take the shares for the values themselves.',
		evidence: [SOURCES.few2012],
		limits: [
			'Only a `%` in the tick label format or in the axis title counts as the unit; a title that names the share in words ("Share of sales") is not read, and a label formatter function is not run.',
			"Of the pinned runtimes only Highcharts stacks as percentages (`stacking: 'percent'`)."
		]
	},
	(chart, report) => {
		if (!chart.series.known) return [];
		const percent = new Set(
			chart.series.items.flatMap(({ stacking, valueAxis }) => {
				const key = valueOf(valueAxis);
				return valueOf(stacking) === 'percent' && key !== undefined ? [key] : [];
			})
		);
		return chart.axes
			.filter(({ key, unit, title }) => {
				const [shown, text] = [valueOf(unit), valueOf(title.text)];
				return (
					percent.has(key) &&
					shown !== undefined &&
					text !== undefined &&
					![shown, text].some((part) => part.includes(PERCENT))
				);
			})
			.map(({ unit }) =>
				report(
					unit.path,
					'The values on this axis are shares of 100, but neither its labels nor its title say so: add a % sign to the labels (`{value}%`) or the title.'
				)
			);
	}
);
