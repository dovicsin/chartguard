import type { ChartLibrary } from '@chartguard/analysis-typescript';
import * as chartjs from '@chartguard/config-chartjs';
import * as echarts from '@chartguard/config-echarts';
import * as highcharts from '@chartguard/config-highcharts';
import type { ConfigValidator } from '@chartguard/core';

import { type ChartGuardSettings, LIBRARIES, SettingsError } from './settings.js';

interface Adapter {
	readonly validate: ConfigValidator;
	/** Absent for the curated Highcharts subset: it has no extension points (CG-02-05). */
	readonly withExtensions?: (extensions: readonly never[]) => ConfigValidator;
	readonly ExtensionError: new (problems: readonly string[]) => Error;
}

const ADAPTERS: Readonly<Record<ChartLibrary, Adapter>> = { chartjs, echarts, highcharts };

/** One library's validator with the extensions the settings give it; a refused extension names its setting (C6). */
function validatorOf(library: ChartLibrary, extensions: readonly unknown[] | undefined): ConfigValidator {
	const adapter = ADAPTERS[library];
	if (extensions === undefined) return adapter.validate;
	const setting = `settings.chartguard.extensions.${library}`;
	if (adapter.withExtensions === undefined)
		throw new SettingsError([`${setting}: the curated Highcharts subset has no extension points`]);
	try {
		return adapter.withExtensions(extensions as readonly never[]);
	} catch (error) {
		if (error instanceof adapter.ExtensionError) throw new SettingsError([`${setting}: ${error.message}`]);
		throw error;
	}
}

/**
 * Every library's validator for these settings, built at once: a wrong extension is wrong in every
 * file, whichever libraries the file uses.
 */
export function validatorsFor(settings: ChartGuardSettings): Readonly<Record<ChartLibrary, ConfigValidator>> {
	const entries = LIBRARIES.map((library) => [library, validatorOf(library, settings.extensions[library])] as const);
	return Object.fromEntries(entries) as Record<ChartLibrary, ConfigValidator>;
}
