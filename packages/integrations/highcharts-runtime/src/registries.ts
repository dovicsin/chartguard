import { isContainer, type RegistryContext } from '@chartguard/core';

/** The part of the `Highcharts` namespace the registry context is read from. */
export interface HighchartsRuntime {
	readonly version?: unknown;
	readonly seriesTypes?: unknown;
}

/**
 * The registry context of a live Highcharts (CG-04-05): the series types it has now, as
 * `highcharts.series`. `Highcharts.seriesTypes` holds every type the bundle and its loaded modules
 * registered, and `Chart#initSeries` throws error #17 for any other (highcharts@13.1.1
 * highcharts.src.js `error(17, true, …)`), so the list is complete for the charts created now.
 * A namespace without `seriesTypes` gives no context, so no claim. Only own keys are read.
 */
export function registriesOf(highcharts: HighchartsRuntime): Readonly<Record<string, RegistryContext>> {
	const types = highcharts.seriesTypes;
	if (!isContainer(types)) return {};
	return { 'highcharts.series': { names: Object.keys(types).sort(), complete: true } };
}
