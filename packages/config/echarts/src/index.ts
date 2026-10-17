import { s, type SchemaManifest, validateConfig } from '@chartguard/config-core';
import type { ValidationResult } from '@chartguard/core';

const AXIS_TYPES = ['value', 'category', 'time', 'log'];
const SERIES_TYPES = [
	'bar',
	'line',
	'pie',
	'scatter',
	'effectScatter',
	'candlestick',
	'radar',
	'map',
	'heatmap',
	'treemap',
	'sunburst',
	'gauge',
	'funnel',
	'sankey',
	'graph',
	'boxplot',
	'pictorialBar',
	'themeRiver',
	'custom'
];

const axis = s.object({
	type: s.string(AXIS_TYPES),
	data: s.array(s.any()),
	name: s.string(),
	min: s.any(),
	max: s.any(),
	axisLabel: s.object({ show: s.boolean(), formatter: s.any() })
});

const series = s.object({
	type: s.string(SERIES_TYPES),
	name: s.string(),
	data: s.array(s.any()),
	encode: s.any()
});

export const manifest: SchemaManifest = {
	library: 'echarts',
	version: '6.x (starter subset)',
	coverage: 'partial',
	source: 'manually curated from public option model; verify against exact target version',
	root: s.object({
		title: s.object({ text: s.string(), subtext: s.string() }),
		xAxis: axis,
		yAxis: axis,
		series: s.array(series),
		legend: s.object({ show: s.boolean() }),
		tooltip: s.object({ show: s.boolean(), trigger: s.string() }),
		dataset: s.object({ source: s.any() }),
		animation: s.boolean()
	})
};

export function validate(input: unknown): ValidationResult {
	return validateConfig(input, manifest);
}
