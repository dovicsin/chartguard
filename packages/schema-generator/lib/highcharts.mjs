import { omit } from './digest.mjs';
import { TypeEmitter } from './emitter.mjs';
import { withHighchartsRuntimeFacts } from './highcharts-runtime.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';
import { runtimePointer, runtimeSection } from './runtime.mjs';
import { artifactOf } from './types.mjs';

const SOURCE_ID = 'highcharts';

/**
 * `Options` from `highcharts.d.ts`, which imports the option declarations of every series type
 * (`options/*.d.ts`): the full option set, like the ECharts full bundle.
 */
const ENTRY = ["import type { Options } from 'highcharts';", 'export type Option = Options;'].join('\n');

/**
 * `Chart#initSeries` resolves `options.type || chart.type` in the series registry and throws error
 * #17 for a type no loaded module registered. A series without `type` (the declarations'
 * `UnknownSeriesOptions`) takes `chart.type`, which `ChartDefaults` sets to `'line'`.
 */
const SERIES_LOOKUP = { file: 'highcharts.src.js', pattern: 'error(17, true, chart, { missingModuleFor: type });' };
const SERIES_TYPE = {
	file: 'highcharts.src.js',
	pattern: 'optionsChart.type), SeriesClass = Chart_seriesTypes[type];'
};
const CHART_DEFAULTS = { file: 'highcharts.src.js', pattern: 'const ChartDefaults = {', end: '};' };
/** A member of the `ChartDefaults` object itself, not of a nested one: four spaces of indentation. */
const DEFAULT_TYPE = /^ {4}type: '(\w+)',$/;

const changed = (what) => new Error(`highcharts types changed: ${what}`);

function typeLiteral(definitions, member) {
	const target = member.kind === 'ref' ? definitions[member.ref] : member;
	const type = target?.kind === 'object' ? target.properties.type?.node : undefined;
	return type?.kind === 'literal' ? type.value : undefined;
}

/** The runtime's default chart type, and the lines that make it the default of a series without type. */
function seriesDefault(root) {
	const defaults = runtimeSection(root, 'highcharts', CHART_DEFAULTS);
	const index = defaults.lines.findIndex((line) => DEFAULT_TYPE.test(line));
	if (index === -1) throw new Error(`highcharts runtime changed: no default chart type at ${defaults.pointer}`);
	const pointers = [
		runtimePointer(root, 'highcharts', SERIES_LOOKUP),
		runtimePointer(root, 'highcharts', SERIES_TYPE),
		defaults.pointerAt(index)
	];
	return {
		fallback: DEFAULT_TYPE.exec(defaults.lines[index])[1],
		provenance: { confidence: 'authoritative', sources: pointers.map((pointer) => ({ source: SOURCE_ID, pointer })) }
	};
}

/**
 * A series variant whose `type` is no longer required: the runtime takes it from `chart.type`
 * (the declarations say so themselves with `UnknownSeriesOptions = Omit<…, "type">`).
 */
function withOptionalType(variant, provenance) {
	const type = { ...omit(variant.properties.type, ['required']), provenance };
	return { ...variant, properties: { ...variant.properties, type } };
}

/** The series item union: one variant per registered series type, told apart by `type`, which defaults to chart.type. */
function seriesUnion(root, definitions, option) {
	const name = option.properties.series?.node.items?.ref;
	const union = definitions[name];
	if (union?.kind !== 'union') throw changed('series is no longer Array<SeriesOptionsType | UnknownSeriesOptions>');
	const typed = union.anyOf.filter((member) => typeLiteral(definitions, member) !== undefined);
	if (union.anyOf.length - typed.length !== 1)
		throw changed('expected exactly one series member without a type literal');
	const { fallback, provenance } = seriesDefault(root);
	const variants = Object.fromEntries(
		typed.map((member) => [member.ref, withOptionalType(definitions[member.ref], provenance)])
	);
	if (typed.some((member) => member.kind !== 'ref')) throw changed('expected every series variant to be a definition');
	return {
		name,
		variants,
		definition: {
			kind: 'union',
			anyOf: typed,
			discriminator: 'type',
			extensible: true,
			defaultFrom: { path: ['chart', 'type'], fallback },
			registry: { id: 'highcharts.series', prefix: '', enforced: true },
			provenance
		}
	};
}

export function generateHighcharts(root, pin) {
	const { program, checker, entry } = createEntryProgram(root, ENTRY);
	const aliases = exportedAliasTypes(checker, entry);
	const emitter = new TypeEmitter({ program, checker, sourceId: SOURCE_ID, packageName: pin.package });
	const optionRef = emitter.reference(aliases.get('Option'));
	const series = seriesUnion(root, emitter.definitions, emitter.definitions[optionRef.ref]);
	const declared = { ...emitter.definitions, ...series.variants, [series.name]: series.definition };
	const definitions = withHighchartsRuntimeFacts(root, declared, {
		optionName: optionRef.ref,
		seriesVariants: Object.keys(series.variants)
	});
	return artifactOf({ library: 'highcharts', sourceId: SOURCE_ID, pin, definitions, root: optionRef });
}
