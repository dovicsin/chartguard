import {
	type Default,
	type Fact,
	isBoolean,
	readFact,
	type TitleSemantics,
	unknown,
	type UnknownFact
} from '@chartguard/quality-core';

/**
 * A y axis without a title text takes the language's `yAxisTitle` (`text: this.chart.options.lang.yAxisTitle`,
 * highcharts.src.js:20306), `Values` by default. A global `Highcharts.setOptions` is not in the config.
 */
const Y_TITLE: Default<string> = {
	value: 'Values',
	pointer: "highcharts@13.1.1 highcharts.src.js:5060 yAxisTitle: 'Values',"
};

/** Highcharts titles: a string, or `null`, the documented way to hide one. */
const isTitle = (value: unknown): value is string | null => value === null || typeof value === 'string';

/**
 * A title from its text: `null` hides it (no text, not shown); otherwise Highcharts has no switch of
 * its own (a title shows when it has text), so whether it is shown is not modelled.
 */
function titleOf(text: Fact<string | null>, at: string): TitleSemantics {
	if (text.known && text.value === null)
		return { text: { ...text, value: '' }, shown: { known: true, value: false, path: text.path, source: 'config' } };
	return { text: text as Fact<string>, shown: unknown(at, 'unmodelled') };
}

/**
 * An axis title as drawn: none on an axis with `title.enabled: false` (`axisTitleOptions.enabled !== false`,
 * highcharts.src.js:22359) or `visible: false` (its title is made in `getOffset`, called only
 * `if (axis.visible)`, :39429). A switch that cannot be read leaves the text unknown (K9).
 */
export function axisTitleOf(
	config: unknown,
	segments: readonly (string | number)[],
	name: 'xAxis' | 'yAxis',
	at: string
): TitleSemantics {
	const switches = [
		readFact(config, [...segments, 'title', 'enabled'], isBoolean),
		readFact(config, [...segments, 'visible'], isBoolean)
	];
	const title = titleOf(axisTitle(config, segments, name), at);
	const off = switches.find((fact) => fact.known && !fact.value);
	if (off !== undefined)
		return { text: title.text, shown: { known: true, value: false, path: off.path, source: 'config' } };
	const unreadable = switches.find((fact): fact is UnknownFact => !fact.known && fact.reason !== 'unset');
	return unreadable === undefined ? title : { text: unreadable, shown: unreadable };
}

/** An axis title text: its own; for y axes, else the chart's `lang.yAxisTitle`, else `Values`. */
function axisTitle(
	config: unknown,
	segments: readonly (string | number)[],
	name: 'xAxis' | 'yAxis'
): Fact<string | null> {
	const own = readFact(config, [...segments, 'title', 'text'], isTitle);
	if (name === 'xAxis' || own.known || own.reason !== 'unset') return own;
	const lang = readFact(config, ['lang', 'yAxisTitle'], isTitle);
	if (lang.known || lang.reason !== 'unset') return lang;
	return { known: true, value: Y_TITLE.value, path: own.path, source: 'default', pointer: Y_TITLE.pointer };
}

const TITLE_TEXT: Default<string> = {
	value: 'Chart title',
	pointer: "highcharts@13.1.1 highcharts.src.js:5417 text: 'Chart title',"
};

/** The chart title: its text, `Chart title` by default; `null` hides it. */
export const chartTitleOf = (config: unknown): TitleSemantics =>
	titleOf(readFact(config, ['title', 'text'], isTitle, TITLE_TEXT), '$.title');
