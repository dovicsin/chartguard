/**
 * The approved performance budgets (CG-07-03), each with the value it was set from: measured on the
 * maintainer's machine on 2026-11-04 (Node 22, no coverage), where a reference unit takes about
 * 33 ms. A time budget is about 4× its measurement (at least 0.05 units, about 2 ms, where timer
 * noise matters), a memory budget about 1.6×, a size about 1.25×. Raise a budget only with the
 * measurement that justifies it, in the same change as the code that needs it. The project
 * opening is measured warm (`probes.mjs` `project`): a first opening is mostly TypeScript compiling.
 */
export const BUDGETS = {
	'validate-chartjs-corpus': { budget: 0.15, measured: 0.032 },
	'quality-chartjs-corpus': { budget: 0.2, measured: 0.052 },
	'quality-chartjs-10000-points': { budget: 0.3, measured: 0.072 },
	'cold-chartjs-time': { budget: 4, measured: 1.16 },
	'cold-chartjs-memory': { budget: 120, measured: 69 },
	'validate-echarts-corpus': { budget: 0.4, measured: 0.102 },
	'quality-echarts-corpus': { budget: 0.6, measured: 0.139 },
	'quality-echarts-10000-points': { budget: 0.6, measured: 0.161 },
	'cold-echarts-time': { budget: 6, measured: 1.96 },
	'cold-echarts-memory': { budget: 140, measured: 86 },
	'validate-highcharts-corpus': { budget: 0.05, measured: 0.005 },
	'quality-highcharts-corpus': { budget: 0.15, measured: 0.029 },
	'quality-highcharts-10000-points': { budget: 0.35, measured: 0.086 },
	'cold-highcharts-time': { budget: 2, measured: 0.49 },
	'cold-highcharts-memory': { budget: 100, measured: 56 },
	'analysis-200-charts': { budget: 2.5, measured: 0.62 },
	'editor-check': { budget: 0.2, measured: 0.042 },
	'editor-project-50-files-open': { budget: 15, measured: 3.6 },
	'editor-project-50-files-edit': { budget: 0.35, measured: 0.083 },
	'editor-project-50-files-memory': { budget: 360, measured: 224 },
	'server-edit': { budget: 0.45, measured: 0.106 },
	'server-start': { budget: 40, measured: 9.8 },
	'cli-validate': { budget: 40, measured: 10.7 },
	'bundle-runtime-chartjs-gzip': { budget: 76, measured: 60.9 },
	'bundle-runtime-echarts-gzip': { budget: 146, measured: 116.3 },
	'bundle-runtime-highcharts-gzip': { budget: 12, measured: 9.5 },
	'bundle-playground-gzip': { budget: 2125, measured: 1699 },
	'schema-chartjs-gzip': { budget: 62, measured: 49 },
	'schema-echarts-gzip': { budget: 136, measured: 108 }
};
