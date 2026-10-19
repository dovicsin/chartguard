import { resolveComponentSubtypes } from './echarts-components.mjs';
import { TypeEmitter } from './emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';
import { artifactOf, typeLookups, unionMembers } from './types.mjs';

const SOURCE_ID = 'echarts';

/**
 * `EChartsOption` is what `chart.setOption(option)` accepts with the full `echarts` bundle.
 * `echarts/core` + `use([...])` registers fewer components; an option for an unregistered
 * component is ignored by the runtime, so the full option set never rejects a valid config.
 */
const ENTRY = ["import type { EChartsOption } from 'echarts';", 'export type Option = EChartsOption;'].join('\n');

const changed = (what) => new Error(`echarts types changed: ${what}`);

/** The `xAxis` variant whose `type` literal is `axisType`. */
function axisVariant(lookups, checker, option, axisType) {
	const variant = unionMembers(lookups.propertyType(option, 'xAxis')).find((member) => {
		if (checker.isArrayType(member)) return false;
		const type = checker.getPropertyOfType(member, 'type');
		return type !== undefined && checker.typeToString(checker.getTypeOfSymbol(type)).includes(`"${axisType}"`);
	});
	if (variant === undefined) throw changed(`no "${axisType}" xAxis variant`);
	return variant;
}

/**
 * `NumericAxisBaseOptionCommon.boundaryGap` is declared as a `[gap, gap]` tuple, but the runtime
 * (lib/coord/scaleRawExtentInfo.js `parseBoundaryGapOption`) accepts a boolean on value, log and
 * time axes and treats it as no gap; the official examples use `boundaryGap: false` on time axes.
 */
function boundaryGapDeclaration(lookups, checker, option) {
	const declaration = lookups.property(axisVariant(lookups, checker, option, 'value'), 'boundaryGap').declarations?.[0];
	if (declaration?.parent?.name?.text !== 'NumericAxisBaseOptionCommon')
		throw changed('boundaryGap is no longer declared on NumericAxisBaseOptionCommon');
	return declaration;
}

/**
 * Positions where the declarations are narrower or wider than the runtime contract:
 * `RegisteredSeriesOption` is documented as the declaration-merging point for extension
 * series (`echarts-wordcloud`, `echarts-liquidfill`), so the series union is extensible;
 * numeric axes accept a boolean `boundaryGap` (see `boundaryGapDeclaration`).
 */
function contractAdjustments(lookups, checker, aliases) {
	const option = aliases.get('Option');
	const series = lookups.propertyType(option, 'series');
	const list = unionMembers(series).find((member) => checker.isArrayType(member));
	if (list === undefined) throw changed('series is no longer `SeriesOption | SeriesOption[]`');
	return {
		extensible: new Set([series, lookups.elementType(list)]),
		widened: new Map([[boundaryGapDeclaration(lookups, checker, option), [{ kind: 'boolean' }]]])
	};
}

export function generateEcharts(root, pin) {
	const { program, checker, entry } = createEntryProgram(root, ENTRY);
	const aliases = exportedAliasTypes(checker, entry);
	const adjustments = contractAdjustments(typeLookups(checker, 'echarts'), checker, aliases);
	const emitter = new TypeEmitter({ program, checker, sourceId: SOURCE_ID, packageName: pin.package, ...adjustments });
	const optionRef = emitter.reference(aliases.get('Option'));
	resolveComponentSubtypes(root, emitter.definitions, emitter.definitions[optionRef.ref]);
	return artifactOf({
		library: 'echarts',
		sourceId: SOURCE_ID,
		pin,
		definitions: emitter.definitions,
		root: optionRef
	});
}
