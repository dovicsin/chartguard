import { TypeEmitter } from './emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';
import { runtimeProvenance } from './runtime.mjs';
import { artifactOf } from './types.mjs';

const SOURCE_ID = 'highcharts';

/**
 * `Options` from `highcharts.d.ts`, which imports the option declarations of every series type
 * (`options/*.d.ts`): the full option set, like the ECharts full bundle.
 */
const ENTRY = ["import type { Options } from 'highcharts';", 'export type Option = Options;'].join('\n');

/**
 * `Chart#initSeries` resolves `options.type || chart.type` in the series registry and throws error
 * #17 for a type no loaded module registered. A series without `type` takes the chart's type,
 * which the declarations model as `UnknownSeriesOptions`; that default lives in another object,
 * so such a series stays inconclusive here rather than being checked against a guessed variant.
 */
const SERIES_LOOKUP = { file: 'highcharts.src.js', pattern: 'error(17, true, chart, { missingModuleFor: type });' };

const changed = (what) => new Error(`highcharts types changed: ${what}`);

function typeLiteral(definitions, member) {
	const target = member.kind === 'ref' ? definitions[member.ref] : member;
	const type = target?.kind === 'object' ? target.properties.type?.node : undefined;
	return type?.kind === 'literal' ? type.value : undefined;
}

/** The series item union: one variant per registered series type, told apart by `type`. */
function seriesUnion(root, definitions, option) {
	const name = option.properties.series?.node.items?.ref;
	const union = definitions[name];
	if (union?.kind !== 'union') throw changed('series is no longer Array<SeriesOptionsType | UnknownSeriesOptions>');
	const typed = union.anyOf.filter((member) => typeLiteral(definitions, member) !== undefined);
	if (union.anyOf.length - typed.length !== 1) throw changed('expected exactly one series member without a type literal');
	return {
		name,
		definition: {
			kind: 'union',
			anyOf: typed,
			discriminator: 'type',
			extensible: true,
			registry: { id: 'highcharts.series', prefix: '', enforced: true },
			provenance: runtimeProvenance(root, { sourceId: SOURCE_ID, packageName: 'highcharts' }, SERIES_LOOKUP)
		}
	};
}

export function generateHighcharts(root, pin) {
	const { program, checker, entry } = createEntryProgram(root, ENTRY);
	const aliases = exportedAliasTypes(checker, entry);
	const emitter = new TypeEmitter({ program, checker, sourceId: SOURCE_ID, packageName: pin.package });
	const optionRef = emitter.reference(aliases.get('Option'));
	const series = seriesUnion(root, emitter.definitions, emitter.definitions[optionRef.ref]);
	const definitions = { ...emitter.definitions, [series.name]: series.definition };
	return artifactOf({ library: 'highcharts', sourceId: SOURCE_ID, pin, definitions, root: optionRef });
}
