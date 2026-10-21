import type { ValidationResult } from '@chartguard/core';

import { type ChartGuard, proceed, remember, validatorOf } from './report.js';

/** The Highcharts constructors: `chart`, and those the Stock, Maps and Gantt bundles add. */
export type ChartFactory = 'chart' | 'stockChart' | 'mapChart' | 'ganttChart';

/** The part of the `Highcharts` namespace this path uses. */
export interface HighchartsNamespace<C extends object> {
	readonly version?: unknown;
	chart?(container: unknown, options: unknown): C;
	stockChart?(container: unknown, options: unknown): C;
	mapChart?(container: unknown, options: unknown): C;
	ganttChart?(container: unknown, options: unknown): C;
}

export interface CreateGuard extends ChartGuard {
	/** The constructor to call (default `chart`). */
	readonly factory?: ChartFactory;
}

/** A chart, unless `block` kept an invalid one from being created, and the result it was checked with. */
export interface Created<C extends object> {
	readonly chart: C | undefined;
	readonly result: ValidationResult;
}

/**
 * The safe construction path (CG-04-04): `options` is validated for the running `Highcharts.version`,
 * reported, then `Highcharts[factory](container, options)` is called unless `block` and invalid. The
 * chart remembers that version for `update` and `addSeries`. Nothing is patched; `options` is never
 * changed and its getters never run.
 */
export function createChart<C extends object>(
	highcharts: HighchartsNamespace<C>,
	container: unknown,
	options: unknown,
	guard: CreateGuard = {}
): Created<C> {
	const factory = guard.factory ?? 'chart';
	if (typeof highcharts[factory] !== 'function') throw new TypeError(`Highcharts.${factory} is not loaded.`);
	const libraryVersion = guard.options?.libraryVersion ?? highcharts.version;
	const settings = typeof libraryVersion === 'string' ? { ...guard.options, libraryVersion } : guard.options;
	const checked = validatorOf(guard)(options, settings);
	if (!proceed(checked, 'create', guard)) return { chart: undefined, result: checked };
	const chart = highcharts[factory](container, options);
	remember(chart, libraryVersion);
	return { chart, result: checked };
}
