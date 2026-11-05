import type { ChartLibrary } from '@chartguard/analysis-typescript';
import * as chartjs from '@chartguard/config-chartjs';
import * as echarts from '@chartguard/config-echarts';
import * as highcharts from '@chartguard/config-highcharts';
import type { ConfigValidator, QualityReport } from '@chartguard/core';
import * as qualityChartjs from '@chartguard/quality-chartjs';
import * as qualityEcharts from '@chartguard/quality-echarts';
import * as qualityHighcharts from '@chartguard/quality-highcharts';
import { otherBuild } from '@chartguard/schema-generator/paths';

import { builtSchema, findInstall, notInstalled } from './install.js';
import { type ChartGuardSettings, SettingsError } from './settings.js';

type ExtensionErrorClass = new (problems: readonly string[]) => Error;

/** A validator built with extensions; a refused extension is named by its setting (C6). */
function extended(
	prefix: string,
	library: ChartLibrary,
	ExtensionError: ExtensionErrorClass,
	build: () => ConfigValidator
): ConfigValidator {
	try {
		return build();
	} catch (error) {
		if (error instanceof ExtensionError)
			throw new SettingsError(prefix, [`${prefix}.extensions.${library}: ${error.message}`]);
		throw error;
	}
}

/** A shipped validator with the extensions the settings give it; built at once, as they are wrong in every file. */
function shipped(
	prefix: string,
	adapter: typeof chartjs | typeof echarts,
	library: ChartLibrary,
	extensions: readonly unknown[] | undefined
): ConfigValidator {
	if (extensions === undefined) return adapter.validate;
	return extended(prefix, library, adapter.ExtensionError, () => adapter.withExtensions(extensions as never[]));
}

const rebuild = (prefix: string, path: string, reason: string): SettingsError =>
	new SettingsError(prefix, [
		`${path} cannot be used: ${reason}\nRebuild it: chartguard schema build --library highcharts`
	]);

/**
 * A built Highcharts schema with the extensions; a schema that does not load, or that another generator
 * or compiler built, is the user's to rebuild (CG-07-06).
 */
function fromBuilt(prefix: string, path: string, text: string, extensions: readonly unknown[]): ConfigValidator {
	let artifact: unknown;
	try {
		artifact = JSON.parse(text);
	} catch (error) {
		throw rebuild(prefix, path, (error as Error).message);
	}
	const other = otherBuild(artifact);
	if (other !== undefined) throw rebuild(prefix, path, other);
	return extended(prefix, 'highcharts', highcharts.ExtensionError, () =>
		highcharts.createValidator(artifact, { extensions: extensions as never[] })
	);
}

/**
 * The validators one ESLint settings object asks for (CG-06-03 part 2). Chart.js and ECharts ship
 * their schemas; Highcharts' full schema cannot ship (license), so a file is checked with the schema
 * built for exactly the version its project installs, else the curated subset, as in the CLI.
 */
export class Validators {
	private readonly chartjs: ConfigValidator;
	private readonly echarts: ConfigValidator;
	/** Built Highcharts validators by schema path, kept while the file on disk is the same. */
	private readonly built = new Map<string, { readonly stamp: string; readonly validate: ConfigValidator }>();

	constructor(
		private readonly settings: ChartGuardSettings,
		/** Where the settings are read, naming them in a setup error. */
		private readonly prefix: string
	) {
		this.chartjs = shipped(prefix, chartjs, 'chartjs', settings.extensions.chartjs);
		this.echarts = shipped(prefix, echarts, 'echarts', settings.extensions.echarts);
	}

	/** The version a file's configs are validated for: as named, or with `"auto"` the one its project installs. */
	versionFor(library: ChartLibrary, fileName: string): string | undefined {
		const named = this.settings.libraryVersion[library];
		if (named !== 'auto') return named;
		const install = findInstall(library, fileName);
		if (install !== undefined) return install.version;
		throw new SettingsError(this.prefix, [
			`${this.prefix}.libraryVersion.${library}: "auto", but ${notInstalled(library, fileName)}; name the version`
		]);
	}

	validatorFor(library: ChartLibrary, fileName: string): ConfigValidator {
		if (library !== 'highcharts') return this[library];
		const install = findInstall(library, fileName);
		const schema = install === undefined ? undefined : builtSchema(library, install);
		if (schema === undefined) return this.curated();
		const known = this.built.get(schema.path);
		if (known?.stamp === schema.stamp) return known.validate;
		const validate = fromBuilt(this.prefix, schema.path, schema.read(), this.settings.extensions.highcharts ?? []);
		this.built.set(schema.path, { stamp: schema.stamp, validate });
		return validate;
	}

	/** The curated subset, which refuses extensions rather than drop them. */
	private curated(): ConfigValidator {
		if (this.settings.extensions.highcharts === undefined) return highcharts.validate;
		throw new SettingsError(this.prefix, [
			`${this.prefix}.extensions.highcharts: the curated Highcharts subset has no extension points; build the full schema: chartguard schema build --library highcharts`
		]);
	}
}

type Review = (config: unknown, options?: ChartGuardSettings['quality']) => QualityReport;

const QUALITY: Readonly<Record<ChartLibrary, Review>> = {
	chartjs: qualityChartjs.analyze,
	echarts: qualityEcharts.analyze,
	highcharts: qualityHighcharts.analyze
};

/** The quality review of one library's configs (advisory, CG-05). */
export const reviewOf = (library: ChartLibrary): Review => QUALITY[library];
