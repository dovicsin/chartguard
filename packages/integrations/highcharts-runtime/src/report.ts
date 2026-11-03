import { validate } from '@chartguard/config-highcharts';
import {
	type ConfigValidator,
	type Diagnostic,
	result,
	type ValidationOptions,
	type ValidationResult
} from '@chartguard/core';

import { type HighchartsRuntime, registriesOf } from './registries.js';

/** Which call a result belongs to. */
export interface ChartEvent {
	readonly phase: 'create' | 'update' | 'addSeries';
}

/**
 * How `update`, `checkUpdate` and `addSeries` validate: the validator, its options, where results go,
 * whether invalid options are applied, and the Highcharts the chart runs on.
 */
export interface ChartGuard {
	/** Replaces the shipped curated `validate`, e.g. `createValidator(artifact)` for the full local schema. */
	readonly validator?: ConfigValidator;
	/**
	 * Passed to every validation. `libraryVersion` defaults to the running `Highcharts.version`, and
	 * `registries` to the series types it has (`registriesOf`); a registry id named here replaces the read one.
	 */
	readonly options?: ValidationOptions;
	/** Receives every result; without it, a result with confirmed errors is written with `console.warn`. */
	readonly onResult?: (result: ValidationResult, event: ChartEvent) => void;
	/** Invalid options are not applied: no chart is created, updated or given the series. */
	readonly block?: boolean;
	/**
	 * The `Highcharts` namespace the chart runs on, for `update` and `addSeries` on a chart not created
	 * through `createChart` (which remembers it): its version and series types are read on every call.
	 * When named, it wins over the remembered one.
	 */
	readonly highcharts?: HighchartsRuntime;
}

/** Every host Highcharts runs in has a console; the package compiles without DOM or Node types. */
declare const console: { warn(...data: unknown[]): void };

/** The Highcharts each chart created through `createChart` was created with. */
const runtimes = new WeakMap<object, HighchartsRuntime>();

export function remember(chart: object, highcharts: HighchartsRuntime): void {
	runtimes.set(chart, highcharts);
}

/**
 * The guard's options with what the running Highcharts says, read now: its version and the series
 * types it has (`registriesOf`). What the caller names (`libraryVersion`, a registry id) wins.
 */
export function settingsFor(highcharts: HighchartsRuntime | undefined, guard: ChartGuard): ValidationOptions {
	const version = guard.options?.libraryVersion ?? highcharts?.version;
	const libraryVersion = typeof version === 'string' ? { libraryVersion: version } : {};
	const registries = { ...(highcharts === undefined ? {} : registriesOf(highcharts)), ...guard.options?.registries };
	return { ...guard.options, ...libraryVersion, ...(Object.keys(registries).length === 0 ? {} : { registries }) };
}

/** The Highcharts a chart runs on: the one the caller names, else the one `createChart` remembered. */
const runtimeOf = (chart: object, guard: ChartGuard): HighchartsRuntime | undefined =>
	guard.highcharts ?? runtimes.get(chart);

/** `settingsFor` the Highcharts the chart runs on (`runtimeOf`). */
export const optionsFor = (chart: object, guard: ChartGuard): ValidationOptions =>
	settingsFor(runtimeOf(chart, guard), guard);

const VERSION_UNKNOWN: Diagnostic = {
	code: 'CFG_VERSION_UNKNOWN',
	severity: 'info',
	confidence: 'unknown',
	path: '$',
	message:
		"The running Highcharts is not known for this chart (it was not created through createChart), so it is checked as the schema's version, without the series types Highcharts has.",
	suggestion: 'Create the chart through createChart, or pass `highcharts` (the namespace) in the guard options.'
};

/**
 * `checked` with `extra` findings, and a note when the running version is not known: no version is
 * named, and the chart's Highcharts (`runtimeOf`) gives none.
 */
export function noted(
	chart: object,
	guard: ChartGuard,
	checked: ValidationResult,
	extra: readonly Diagnostic[] = []
): ValidationResult {
	const version = guard.options?.libraryVersion ?? runtimeOf(chart, guard)?.version;
	const notes = typeof version === 'string' ? extra : [...extra, VERSION_UNKNOWN];
	if (notes.length === 0) return checked;
	return {
		...checked,
		...result(checked.library, checked.schemaVersion, checked.coverage, [...checked.diagnostics, ...notes])
	};
}

export const validatorOf = (guard: ChartGuard): ConfigValidator => guard.validator ?? validate;

function warn(checked: ValidationResult, { phase }: ChartEvent): void {
	if (checked.valid) return;
	const listed = checked.diagnostics
		.filter(({ severity }) => severity === 'error')
		.map(({ path, message }) => `${path} (${message})`)
		.join('; ');
	console.warn(`ChartGuard: ${checked.library} options invalid at ${phase}: ${listed}`);
}

/** Hands the result to `onResult`, or warns; true when the call may go ahead. */
export function proceed(checked: ValidationResult, phase: ChartEvent['phase'], guard: ChartGuard): boolean {
	(guard.onResult ?? warn)(checked, { phase });
	return guard.block !== true || checked.valid;
}
