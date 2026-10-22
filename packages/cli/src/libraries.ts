import type { ConfigValidator, QualityReport } from '@chartguard/core';
import type { QualityOptions } from '@chartguard/quality-chartjs';

export type { QualityOptions };

const LIBRARIES = ['chartjs', 'echarts', 'highcharts'] as const;
export type Library = (typeof LIBRARIES)[number];

interface ConfigAdapter {
	readonly validate: ConfigValidator;
}

export interface QualityAdapter {
	readonly analyze: (config: unknown, options?: QualityOptions) => QualityReport;
	/** Throws the adapter's `QualityOptionsError` listing every problem of the options. */
	readonly assertQualityOptions: (value: unknown) => asserts value is QualityOptions;
	readonly QualityOptionsError: new (problems: readonly string[]) => Error;
}

/** Adapters load lazily so a run only pulls in the requested library. */
const CONFIG_ADAPTERS: Record<Library, () => Promise<ConfigAdapter>> = {
	chartjs: () => import('@chartguard/config-chartjs'),
	echarts: () => import('@chartguard/config-echarts'),
	highcharts: () => import('@chartguard/config-highcharts')
};

const QUALITY_ADAPTERS: Record<Library, () => Promise<QualityAdapter>> = {
	chartjs: () => import('@chartguard/quality-chartjs'),
	echarts: () => import('@chartguard/quality-echarts'),
	highcharts: () => import('@chartguard/quality-highcharts')
};

export function isLibrary(value: string): value is Library {
	return LIBRARIES.some((library) => library === value);
}

export function loadConfigAdapter(library: Library): Promise<ConfigAdapter> {
	return CONFIG_ADAPTERS[library]();
}

export function loadQualityAdapter(library: Library): Promise<QualityAdapter> {
	return QUALITY_ADAPTERS[library]();
}
