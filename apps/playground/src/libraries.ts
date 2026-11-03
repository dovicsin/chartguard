import type { Adapter } from './model.js';

export type LibraryId = 'chartjs' | 'echarts' | 'highcharts';

export interface Library {
	readonly id: LibraryId;
	readonly label: string;
	/** The published adapter entry points; loaded on first use so each library is its own chunk. */
	readonly adapter: () => Promise<Adapter>;
	/** Why there is no preview, shown instead of the chart, when the runtime is not bundled into the frame. */
	readonly noPreview?: string;
}

export const LIBRARIES: readonly Library[] = [
	{
		id: 'chartjs',
		label: 'Chart.js 4.5.1',
		adapter: async (): Promise<Adapter> => {
			const [config, quality] = await Promise.all([
				import('@chartguard/config-chartjs'),
				import('@chartguard/quality-chartjs')
			]);
			return { validate: config.validate, analyze: quality.analyze };
		}
	},
	{
		id: 'echarts',
		label: 'Apache ECharts 6.1.0',
		adapter: async (): Promise<Adapter> => {
			const [config, quality] = await Promise.all([
				import('@chartguard/config-echarts'),
				import('@chartguard/quality-echarts')
			]);
			return { validate: config.validate, analyze: quality.analyze };
		}
	},
	{
		id: 'highcharts',
		label: 'Highcharts 13.x (curated subset)',
		adapter: async (): Promise<Adapter> => {
			const [config, quality] = await Promise.all([
				import('@chartguard/config-highcharts'),
				import('@chartguard/quality-highcharts')
			]);
			return { validate: config.validate, analyze: quality.analyze };
		},
		noPreview: 'No preview: the Highcharts runtime is not bundled (no license for redistribution).'
	}
];

export function libraryById(id: string): Library | undefined {
	return LIBRARIES.find((library) => library.id === id);
}
