import {
	type Default,
	type Fact,
	isBoolean,
	isDefined,
	isString,
	type Item,
	readFact,
	readPath,
	type TitleSemantics,
	unknown,
	unreadable
} from '@chartguard/quality-core';

/**
 * A dataset's legend entry is its raw `label` (the legend plugin's `generateLabels`); without one the
 * text is `undefined`, which the canvas draws as the word "undefined" (`fillText` takes a string).
 */
const UNLABELLED: Default<string> = {
	value: 'undefined',
	pointer: 'chart.js@4.6.1 dist/chart.js:8885 text: datasets[meta.index].label,'
};

/** The legend is drawn unless the config turns it off. */
const DISPLAYED: Default<boolean> = {
	value: true,
	pointer: 'chart.js@4.6.1 dist/chart.js:8855 display: true, [in var plugin_legend]'
};

/**
 * Chart types whose legend lists `data.labels`, not the datasets: their `overrides` replace
 * `generateLabels` (doughnut, inherited by pie, dist/chart.js:1854; polarArea, :2221).
 */
const BY_LABELS = new Set(['pie', 'doughnut', 'polarArea']);

const LEGEND = ['options', 'plugins', 'legend'];

/** `false` turns a plugin off for the chart (`plugins: false` turns off every plugin). */
function switchedOff(config: unknown): Fact<boolean> | undefined {
	for (const path of [['options', 'plugins'], LEGEND])
		if (readPath(config, path) === false) return readFact(config, path, isBoolean);
	return undefined;
}

/**
 * Whether the legend draws an entry for every dataset: displayed (`display`, true by default) and
 * listing the datasets with the default `generateLabels`. A callback that makes or filters the entries
 * decides at runtime (`dynamic`).
 */
export function legendShown(config: unknown): Fact<boolean> {
	const off = switchedOff(config);
	if (off !== undefined) return off;
	const display = readFact(config, [...LEGEND, 'display'], isBoolean, DISPLAYED);
	if (!display.known || !display.value) return display;
	for (const name of ['generateLabels', 'filter']) {
		const callback = readFact(config, [...LEGEND, 'labels', name], isDefined);
		if (callback.known) return unknown(callback.path, 'dynamic');
		if (unreadable(callback)) return callback;
	}
	return display;
}

/**
 * A dataset's legend entry: its `label`, or "undefined"; drawn when the legend shows the datasets
 * (`shown`, read once per chart). A pie, doughnut or polar area chart lists its labels instead.
 */
export function legendOf(config: unknown, item: Item, chartType: Fact<string>, shown: Fact<boolean>): TitleSemantics {
	const text = readFact(config, [...item.segments, 'label'], isString, UNLABELLED);
	if (!chartType.known) return { text, shown: unknown(chartType.path, chartType.reason) };
	return { text, shown: BY_LABELS.has(chartType.value) ? unknown(chartType.path, 'inapplicable') : shown };
}
