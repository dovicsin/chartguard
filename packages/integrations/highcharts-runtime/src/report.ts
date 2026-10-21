import { validate } from '@chartguard/config-highcharts';
import type { ConfigValidator, ValidationOptions, ValidationResult } from '@chartguard/core';

/** Which call a result belongs to. */
export interface ChartEvent {
	readonly phase: 'create' | 'update' | 'addSeries';
}

export interface ChartGuard {
	/** Replaces the shipped curated `validate`, e.g. `createValidator(artifact)` for the full local schema. */
	readonly validator?: ConfigValidator;
	/** Passed to every validation; `libraryVersion` defaults to the `Highcharts.version` the chart was created with. */
	readonly options?: ValidationOptions;
	/** Receives every result; without it, a result with confirmed errors is written with `console.warn`. */
	readonly onResult?: (result: ValidationResult, event: ChartEvent) => void;
	/** Invalid options are not applied: no chart is created, updated or given the series. */
	readonly block?: boolean;
}

/** Every host Highcharts runs in has a console; the package compiles without DOM or Node types. */
declare const console: { warn(...data: unknown[]): void };

/** The `Highcharts.version` each chart created through `createChart` was created with. */
const versions = new WeakMap<object, string>();

export function remember(chart: object, version: unknown): void {
	if (typeof version === 'string') versions.set(chart, version);
}

/** The guard's options, with the chart's remembered version unless the caller names one. */
export function optionsFor(chart: object, guard: ChartGuard): ValidationOptions {
	const libraryVersion = guard.options?.libraryVersion ?? versions.get(chart);
	return { ...guard.options, ...(libraryVersion === undefined ? {} : { libraryVersion }) };
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
