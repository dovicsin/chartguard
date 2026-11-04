import { rule, SOURCES } from './catalog.js';
import type { TitleSemantics } from './chart.js';
import { valueOf } from './facts.js';
import { CARTESIAN, configured, measuredAxes } from './measure.js';

/** The label rules (CG-05-04 part 3): what a chart's titles say, or do not. */

/** A title text from the runtime's default that is not blank and not known to be hidden: a placeholder. */
function placeholder({ text, shown }: TitleSemantics): string | undefined {
	if (!text.known || text.source !== 'default' || text.value.trim() === '' || valueOf(shown) === false)
		return undefined;
	return text.path;
}

export const placeholderText = rule(
	{
		id: 'placeholder-text',
		code: 'VIS_PLACEHOLDER_TEXT',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: {
			offered: false,
			why: 'The title has to say what is shown, which only the author knows; hiding it would leave the chart without one.'
		},
		title: "A title showing the library's placeholder text",
		rationale:
			'A title or axis title the config does not set can still be drawn with the library\'s placeholder text (Highcharts draws "Chart title" and a y axis titled "Values"). It tells the reader nothing about the chart and is announced as its label by assistive technology.',
		evidence: [SOURCES.wcag22Labels],
		limits: [
			'Texts set outside the config (a global `Highcharts.setOptions`, a language pack) are not seen: the finding is wrong when they replace the placeholder.',
			'Only the chart title and the titles of value axes are checked.'
		]
	},
	(chart, report) => {
		const axes = measuredAxes(chart, CARTESIAN).map(({ axis }) => axis.title);
		return [chart.title, ...axes].flatMap((title) => {
			const path = placeholder(title);
			return path === undefined
				? []
				: [
						report(
							path,
							"This title shows the library's placeholder text; set a title that says what is shown, or hide it."
						)
					];
		});
	}
);

/** Whether a title is known to show nothing: hidden, or blank text. */
const absent = ({ text, shown }: TitleSemantics): boolean => valueOf(shown) === false || valueOf(text)?.trim() === '';

export const valueAxisUntitled = rule(
	{
		id: 'value-axis-untitled',
		code: 'VIS_VALUE_AXIS_UNTITLED',
		severity: 'info',
		impact: 'omits',
		context: [],
		fix: { offered: false, why: "The quantity and its unit are the author's to name." },
		title: 'A value axis without a title, in a chart without one',
		rationale:
			'Numbers on an axis mean little without what they count and in which unit. An axis title is the usual place for the quantity and its unit.',
		evidence: [SOURCES.few2012],
		limits: [
			'The quantity and unit may be given elsewhere: the chart title or subtitle, the tick labels (a currency sign), or the text around the chart. The finding is a reminder.',
			'Only value axes of cartesian series are checked, and only when both their title and the chart title are known to show nothing: a chart title may carry the quantity.'
		]
	},
	// Only when no text names the quantity: the chart title is known to show nothing too.
	(chart, report) =>
		measuredAxes(chart, CARTESIAN)
			.filter(({ axis }) => absent(axis.title) && absent(chart.title))
			.map(({ axis }) =>
				report(
					axis.title.text.path,
					'Neither this value axis nor the chart has a title: say what is measured and in which unit.'
				)
			)
);

export const emptyTitle = rule(
	{
		id: 'empty-title',
		code: 'VIS_EMPTY_TITLE',
		severity: 'info',
		impact: 'omits',
		context: [],
		fix: {
			offered: false,
			why: "Hiding the blank title would silence the finding but still give readers no context; the words are the author's."
		},
		title: 'An empty chart title',
		rationale:
			'A title the config sets to blank text shows nothing; the chart needs its context (what, where, when) from somewhere, and assistive technology needs a text alternative.',
		evidence: [SOURCES.wcag22],
		limits: [
			'The context may be given next to the chart, outside the config; the finding is a reminder, not a defect.',
			'A title known to be hidden is not reported.'
		]
	},
	({ title: { text, shown } }, report) => {
		if (configured(text)?.trim() !== '' || valueOf(shown) === false) return [];
		return [report(text.path, 'Chart title is empty; ensure context is supplied nearby.')];
	}
);

/** Whether a legend entry is drawn with a text the runtime made up: from its default, not blank, and known to be drawn. */
const madeUp = ({ text, shown }: TitleSemantics): boolean =>
	text.known && text.source === 'default' && text.value.trim() !== '' && valueOf(shown) === true;

export const legendPlaceholder = rule(
	{
		id: 'legend-placeholder',
		code: 'VIS_LEGEND_PLACEHOLDER',
		severity: 'warning',
		impact: 'misleads',
		context: [],
		fix: {
			offered: false,
			why: 'The name has to say what the series shows, which only the author knows; hiding the entry would leave the reader no key to the series.'
		},
		title: "A legend entry showing the library's placeholder for an unnamed series",
		rationale:
			'A series the config does not name still gets an entry in the legend, labelled with what the library makes up (Highcharts draws "Series 1", "Series 2" …, Chart.js the text "undefined"). The legend is the key to which series is which: a made-up label tells the reader nothing, and assistive technology reads it out as the series\' name.',
		evidence: [SOURCES.wcag22Labels],
		limits: [
			'Names and legend settings outside the config (a global `Highcharts.setOptions` or language pack, `Chart.defaults`, a plugin) are not seen: the finding is wrong when they name the series.',
			'A legend whose entries a function or a template decides (Chart.js `labels.generateLabels` or `labels.filter`, Highcharts `labelFormatter` or `labelFormat`, ECharts `formatter`), or one that lists names of its own (ECharts `legend.data`), is not checked.',
			'Only a series\' own entry is checked: the entries for the points of a pie (Chart.js `data.labels`, Highcharts "Slice") are not.',
			'Chart.js draws a legend only with its Legend plugin registered (`chart.js/auto` registers it): a build without it draws none, and the finding is wrong there.'
		]
	},
	(chart, report) => {
		if (!chart.series.known) return [];
		return chart.series.items.flatMap(({ legend }) =>
			madeUp(legend)
				? [
						report(
							legend.text.path,
							`This series has no name: its legend entry shows "${valueOf(legend.text) ?? ''}", which the library made up. Name the series.`
						)
					]
				: []
		);
	}
);
