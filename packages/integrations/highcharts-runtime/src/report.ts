import { validate } from '@chartguard/config-highcharts';
import type { ConfigValidator, ValidationOptions, ValidationResult } from '@chartguard/core';

import { type HighchartsRuntime, registriesOf } from './registries.js';

/** Which call a result belongs to. */
export interface ChartEvent {
	readonly phase: 'create' | 'update' | 'addSeries';
}

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

/** `settingsFor` the Highcharts the chart was created with, if it was created through `createChart`. */
export const optionsFor = (chart: object, guard: ChartGuard): ValidationOptions =>
	settingsFor(runtimes.get(chart), guard);

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
