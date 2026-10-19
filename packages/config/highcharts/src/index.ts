import {
	type Extension,
	manifestFromArtifact,
	s,
	type SchemaManifest,
	validateConfig,
	withExtensions
} from '@chartguard/config-core';
import type { ConfigValidator, ValidationOptions, ValidationResult } from '@chartguard/core';

export { type Extension, ExtensionError } from '@chartguard/config-core';

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

export function validate(input: unknown, options?: ValidationOptions): ValidationResult {
	return validateConfig(input, manifest, options);
}

/**
 * A validator for a schema artifact generated from the caller's own installed `highcharts`
 * (`node tools/schema-generator/generate.mjs write highcharts`, written to
 * `node_modules/.cache/chartguard/`). This package never ships a Highcharts-derived schema: the
 * Highcharts license does not clear redistributing it (CG-01-05). `extensions` add plugin series to
 * the `highcharts.series` registry (CG-02-05). Throws for a malformed artifact, one generated for
 * another library, or a refused extension (`ExtensionError`).
 */
export function createValidator(
	artifact: unknown,
	{ extensions = [] }: { readonly extensions?: readonly Extension[] } = {}
): ConfigValidator {
	const generated = manifestFromArtifact(artifact);
	if (generated.library !== 'highcharts')
		throw new Error(`Expected a highcharts schema artifact, got one for ${generated.library}.`);
	const extended = extensions.length === 0 ? generated : withExtensions(generated, extensions);
	return (input, options) => validateConfig(input, extended, options);
}
