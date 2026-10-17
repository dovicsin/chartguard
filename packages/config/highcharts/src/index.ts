import { s, type SchemaManifest, validateConfig } from '@chartguard/config-core';
import type { ValidationResult } from '@chartguard/core';

const toggle = s.object({ enabled: s.boolean() });
const text = s.object({ text: s.string() });

const axis = s.object({
	min: s.number(),
	max: s.number(),
	categories: s.array(s.string()),
	title: text
});

const series = s.object({
	type: s.string(),
	name: s.string(),
	data: s.array(s.any()),
	color: s.string()
});

export const manifest: SchemaManifest = {
	library: 'highcharts',
	version: '12.x (starter subset)',
	coverage: 'partial',
	source: 'manually curated from public option tree; verify against exact target version',
	root: s.object({
		chart: s.object({ type: s.string(), height: s.number(), width: s.number(), zooming: s.any() }),
		title: text,
		subtitle: text,
		xAxis: axis,
		yAxis: axis,
		series: s.array(series),
		legend: toggle,
		credits: toggle,
		tooltip: toggle
	})
};

export function validate(input: unknown): ValidationResult {
	return validateConfig(input, manifest);
}
