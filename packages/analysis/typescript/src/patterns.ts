import { isRecord } from '@chartguard/core';

import { type Origin, packageOf } from './origins.js';

export type ChartLibrary = 'chartjs' | 'echarts' | 'highcharts';
const LIBRARIES: readonly ChartLibrary[] = ['chartjs', 'echarts', 'highcharts'];

/**
 * A project's own way of handing a config to a chart library (CG-03-06). `module` is a package
 * specifier, `file` a project file (absolute); `export` a dotted path (`default.render`); the config
 * is call argument `argument`, or JSX prop `prop`. `construct`: only `new …(…)` matches.
 */
export interface ChartPattern {
	readonly id: string;
	readonly library: ChartLibrary;
	readonly module?: string;
	readonly file?: string;
	readonly export: string;
	readonly argument?: number;
	readonly prop?: string;
	readonly construct?: boolean;
}

/** Patterns that cannot be used; every problem is listed. The caller's input, never ChartGuard's defect. */
export class PatternError extends Error {
	override readonly name = 'PatternError';
	constructor(readonly problems: readonly string[]) {
		super(`Patterns refused:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
	}
}

/** Which arguments hold the config: an index, or Highcharts' `chart([renderTo,] options[, callback])`. */
export type ArgumentRule = number | 'highcharts-options';

/** What a JSX tag gives as config: one prop, or react-chartjs-2's `{ type, data, options, plugins }`. */
export type PropRule = { readonly prop: string } | { readonly chartType: string | undefined };

/** A pattern as matched: an origin it accepts, and where its config is. */
export interface Rule {
	readonly id: string;
	readonly library: ChartLibrary;
	readonly package?: string;
	readonly file?: string;
	readonly paths: readonly (readonly string[])[];
	readonly call?: { readonly argument: ArgumentRule; readonly construct: boolean | 'either' };
	readonly jsx?: PropRule;
}

const either = (name: string): string[][] => [[name], ['default', name]];

const REACT_CHARTJS_TYPES: Readonly<Record<string, string>> = {
	Bar: 'bar',
	Bubble: 'bubble',
	Doughnut: 'doughnut',
	Line: 'line',
	Pie: 'pie',
	PolarArea: 'polarArea',
	Radar: 'radar',
	Scatter: 'scatter'
};

const HIGHCHARTS_FACTORIES = ['chart', 'stockChart', 'mapChart', 'ganttChart'];

/** The libraries' own entry points and wrappers; ECharts `setOption` is matched by its instance (`uses.ts`). */
const BUILT_IN_RULES: readonly Rule[] = [
	{
		id: 'chartjs.new-chart',
		library: 'chartjs',
		package: 'chart.js',
		paths: [['Chart'], ['default']],
		call: { argument: 1, construct: true }
	},
	{
		id: 'chartjs.react-chartjs-2',
		library: 'chartjs',
		package: 'react-chartjs-2',
		paths: [['Chart']],
		jsx: { chartType: undefined }
	},
	...Object.entries(REACT_CHARTJS_TYPES).map(([component, chartType]): Rule => ({
		id: 'chartjs.react-chartjs-2',
		library: 'chartjs',
		package: 'react-chartjs-2',
		paths: [[component]],
		jsx: { chartType }
	})),
	{
		id: 'echarts.echarts-for-react',
		library: 'echarts',
		package: 'echarts-for-react',
		paths: [['default'], ['EChartsReactCore']],
		jsx: { prop: 'option' }
	},
	{
		id: 'highcharts.chart',
		library: 'highcharts',
		package: 'highcharts',
		paths: HIGHCHARTS_FACTORIES.flatMap(either),
		call: { argument: 'highcharts-options', construct: false }
	},
	{
		id: 'highcharts.chart',
		library: 'highcharts',
		package: 'highcharts',
		paths: either('Chart'),
		call: { argument: 'highcharts-options', construct: true }
	},
	{
		id: 'highcharts.highcharts-react',
		library: 'highcharts',
		package: 'highcharts-react-official',
		paths: [['default'], ['HighchartsReact']],
		jsx: { prop: 'options' }
	},
	...LIBRARIES.map((library): Rule => ({
		id: `${library}.validate-before-create`,
		library,
		package: `@chartguard/runtime-${library}`,
		paths: [['validateBeforeCreate']],
		call: { argument: 0, construct: false }
	}))
];

/** `echarts.init` and `init` from `echarts` or `echarts/core`: the instances `setOption` is called on. */
export const ECHARTS_INIT: Rule = {
	id: 'echarts.set-option',
	library: 'echarts',
	package: 'echarts',
	paths: either('init')
};

const withoutExtension = (file: string): string => file.replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/, '');

export function matches(rule: Rule, origin: Origin): boolean {
	const from =
		rule.package === undefined
			? origin.file !== undefined &&
				rule.file !== undefined &&
				withoutExtension(origin.file) === withoutExtension(rule.file)
			: origin.package === rule.package;
	return (
		from &&
		rule.paths.some(
			(path) => path.length === origin.path.length && path.every((name, index) => name === origin.path[index])
		)
	);
}

const isNonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Where the wrapper comes from and what it is called. */
function sourceProblems({ library, module, file, export: exported }: Record<string, unknown>): string[] {
	const problems: string[] = [];
	if (!LIBRARIES.some((known) => known === library)) problems.push('library must be chartjs, echarts or highcharts');
	if (isNonEmpty(module) === isNonEmpty(file)) problems.push('exactly one of module and file');
	if (!isNonEmpty(exported) || exported.split('.').some((name) => name === ''))
		problems.push('export must be a non-empty dotted path');
	return problems;
}

/** Where its config is: one argument or one JSX prop. */
function configProblems({ argument, prop, construct }: Record<string, unknown>): string[] {
	const problems: string[] = [];
	if ((argument === undefined) === (prop === undefined)) problems.push('exactly one of argument and prop');
	else if (argument !== undefined && !(Number.isInteger(argument) && Number(argument) >= 0))
		problems.push('argument must be a non-negative integer');
	else if (prop !== undefined && !isNonEmpty(prop)) problems.push('prop must be a non-empty string');
	if (construct !== undefined && typeof construct !== 'boolean') problems.push('construct must be a boolean');
	return problems;
}

function patternProblems(pattern: unknown, index: number): string[] {
	if (!isRecord(pattern)) return [`pattern ${String(index + 1)}: must be an object`];
	const { id } = pattern;
	if (!isNonEmpty(id)) return [`pattern ${String(index + 1)}: id must be a non-empty string`];
	return [...sourceProblems(pattern), ...configProblems(pattern)].map((problem) => `${id}: ${problem}`);
}

function ruleOf(pattern: ChartPattern): Rule {
	const source = pattern.module === undefined ? { file: pattern.file ?? '' } : { package: packageOf(pattern.module) };
	const shape =
		pattern.prop === undefined
			? {
					call: { argument: pattern.argument ?? 0, construct: pattern.construct === true ? true : ('either' as const) }
				}
			: { jsx: { prop: pattern.prop } };
	return { id: pattern.id, library: pattern.library, ...source, paths: [pattern.export.split('.')], ...shape };
}

/** The built-in rules followed by the given patterns, checked first; throws `PatternError` with every problem. */
export function rulesOf(patterns: readonly unknown[] = []): readonly Rule[] {
	const problems = patterns.flatMap(patternProblems);
	if (problems.length > 0) throw new PatternError(problems);
	return [...BUILT_IN_RULES, ...(patterns as readonly ChartPattern[]).map(ruleOf)];
}
