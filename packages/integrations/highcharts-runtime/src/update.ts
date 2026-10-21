import { result, type ValidationResult } from '@chartguard/core';

import { type ChartGuard, optionsFor, proceed, validatorOf } from './report.js';
import { chartTypeOf, type HighchartsChart, planUpdate, typed } from './series.js';

/** `chart.update`'s arguments after the options. */
export interface UpdateSettings {
	readonly redraw?: boolean;
	/** Add the series no item matches and remove the ones none reaches (Highcharts' `oneToOne`). */
	readonly oneToOne?: boolean;
	readonly animation?: unknown;
}

/** `chart.addSeries`'s arguments after the options. */
export interface AddSeriesSettings {
	readonly redraw?: boolean;
	readonly animation?: unknown;
}

/** The series `chart.addSeries` returned, unless `block` kept an invalid one out, and its result. */
export interface Added<S> {
	readonly series: S | undefined;
	readonly result: ValidationResult;
}

/**
 * `options` validated as `chart.update(options, …, oneToOne)` applies it to this chart; nothing is
 * updated. An update is partial by design (what it leaves out, the chart has), so it is validated as
 * incomplete; each series item is checked as the type of the series it reaches, and one the update
 * ignores is a `CFG_INEFFECTIVE` warning.
 */
export function checkUpdate(
	chart: HighchartsChart,
	options: unknown,
	settings: UpdateSettings = {},
	guard: ChartGuard = {}
): ValidationResult {
	const { view, findings, pathOf } = planUpdate(chart, options, settings.oneToOne === true);
	const checked = validatorOf(guard)(view, { ...optionsFor(chart, guard), incomplete: true });
	const diagnostics = checked.diagnostics.map((diagnostic) => ({ ...diagnostic, path: pathOf(diagnostic.path) }));
	return {
		...checked,
		...result(checked.library, checked.schemaVersion, checked.coverage, [...diagnostics, ...findings])
	};
}

/** The safe `chart.update` path (CG-04-04): `checkUpdate`, reported, then the update unless `block` and invalid. */
export function update(
	chart: HighchartsChart,
	options: unknown,
	settings: UpdateSettings = {},
	guard: ChartGuard = {}
): ValidationResult {
	const checked = checkUpdate(chart, options, settings, guard);
	if (proceed(checked, 'update', guard)) chart.update(options, settings.redraw, settings.oneToOne, settings.animation);
	return checked;
}

/**
 * The safe `chart.addSeries` path: the series is validated as `{ series: [options] }` (so its
 * findings are under `$.series[0]`), with the chart's type when it has none (`Chart#initSeries`),
 * reported, then added unless `block` and invalid.
 */
export function addSeries<C extends HighchartsChart>(
	chart: C,
	options: unknown,
	settings: AddSeriesSettings = {},
	guard: ChartGuard = {}
): Added<ReturnType<C['addSeries']>> {
	const view = { series: [typed(options, chartTypeOf(chart, undefined))] };
	const checked = validatorOf(guard)(view, { ...optionsFor(chart, guard), incomplete: true });
	if (!proceed(checked, 'addSeries', guard)) return { series: undefined, result: checked };
	const series = chart.addSeries(options, settings.redraw, settings.animation) as ReturnType<C['addSeries']>;
	return { series, result: checked };
}
