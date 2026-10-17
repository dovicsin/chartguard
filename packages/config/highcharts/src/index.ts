import { s, type SchemaManifest, validateConfig } from '@chartguard/config-core';
import type { ValidationResult } from '@chartguard/core';

const toggle = s.object({ enabled: s.boolean() });
const text = s.object({ text: s.string() });

/**
 * Union-typed upstream fields stay open until the schema DSL supports unions (CG-02-01):
 * a narrower guess would reject valid configs.
 */
const union = s.any;

const series = s.object({
	type: s.string(),
	name: s.string(),
	data: s.array(s.any()),
	color: union() // ColorString | GradientColorObject | PatternObject
});

export const manifest: SchemaManifest = {
	library: 'highcharts',
	version: '13.x (starter subset)',
	coverage: 'partial',
	source: 'manually curated; field types checked against highcharts@13.1.1 TypeScript declarations',
	root: s.object({
		chart: s.object({
			type: s.string(),
			height: union(), // number | string | null
			width: union(), // number | string | null
			zooming: s.any()
		}),
		title: text,
		subtitle: text,
		xAxis: union(), // XAxisOptions | XAxisOptions[]
		yAxis: union(), // YAxisOptions | YAxisOptions[]
		series: s.array(series),
		legend: toggle,
		credits: toggle,
		tooltip: toggle
	})
};

export function validate(input: unknown): ValidationResult {
	return validateConfig(input, manifest);
}
