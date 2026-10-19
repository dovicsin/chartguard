import { ELEMENT_SCOPE, planOptionScopes } from './chartjs-scopes.mjs';
import { TypeEmitter } from './emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';
import { makeOptionsScriptable } from './scriptable.mjs';
import { artifactOf, typeLookups, unionMembers } from './types.mjs';

const SOURCE_ID = 'chartjs';
/** `DeepPartial<T>` / `_DeepPartialObject<T>` (dist/types/utils.d.ts) map over primitives unchanged. */
const WRAPPERS = new Set(['DeepPartial', '_DeepPartialObject']);

/** Chart types as declared by the augmentable `ChartTypeRegistry`. */
function registeredChartTypes(root) {
	const { program, checker, entry } = createEntryProgram(
		root,
		"import type { ChartTypeRegistry } from 'chart.js';\nexport type Registry = keyof ChartTypeRegistry;"
	);
	const registry = exportedAliasTypes(checker, entry).get('Registry');
	return { program, chartTypes: unionMembers(registry).map((member) => member.value).sort() };
}

function entryText(chartTypes) {
	const lines = chartTypes.flatMap((chartType) => [
		`export type Config_${chartType} = ChartConfiguration<'${chartType}'>;`,
		`export type Dataset_${chartType} = ChartDataset<'${chartType}'>;`
	]);
	return ["import type { ChartConfiguration, ChartDataset } from 'chart.js';", ...lines].join('\n');
}

/**
 * Positions where the declarations are narrower or wider than the runtime contract:
 * data points depend on the caller's generic `TData`, inline plugins are user objects,
 * `options.plugins` is extended by third-party plugins through declaration merging,
 * `options.scales[*]` variants come from `ScaleTypeRegistry`, which plugins merge into
 * (chartjs-plugin-streaming, chartjs-chart-matrix), and `config.data`, `data.datasets`
 * and `dataset.data` are defaulted by the runtime (`initConfig`/`initData` in
 * chart.js/dist/chart.js, `config.data = config.data || {}`, `data.datasets = data.datasets || []`,
 * `_dataCheck`: `dataset.data || (dataset.data = [])`), so their absence is not an error.
 */
function adjustChartType(lookups, { config, datasetTypes }, into) {
	const { property, propertyType, indexValueType, elementType } = lookups;
	const data = propertyType(config, 'data');
	const datasetType = elementType(propertyType(data, 'datasets'));
	const options = propertyType(config, 'options');
	into.opaque.add(elementType(propertyType(config, 'plugins')));
	const plugins = propertyType(options, 'plugins');
	into.open.add(plugins);
	// getOpts (chart.js `PluginService`): `false` disables a plugin, `true` enables it with defaults.
	for (const plugin of lookups.checker.getPropertiesOfType(plugins))
		into.widened.set(plugin.declarations?.[0], [{ kind: 'boolean' }]);
	into.extensible.add(indexValueType(propertyType(options, 'scales')));
	into.runtimeOptional.add(property(config, 'data'));
	into.runtimeOptional.add(property(data, 'datasets'));
	for (const dataset of [datasetType, ...datasetTypes]) {
		into.opaque.add(propertyType(dataset, 'data'));
		into.runtimeOptional.add(property(dataset, 'data'));
	}
	into.datasetVariants.set(datasetType, [datasetType, ...datasetTypes]);
}

function contractAdjustments(checker, chartTypes, aliases) {
	const into = {
		opaque: new Set(),
		open: new Set(),
		extensible: new Set(),
		runtimeOptional: new Set(),
		widened: new Map(),
		datasetVariants: new Map()
	};
	for (const chartType of chartTypes) {
		const config = aliases.get(`Config_${chartType}`);
		const datasetTypes = chartTypes.filter((other) => other !== chartType).map((other) => aliases.get(`Dataset_${other}`));
		adjustChartType(typeLookups(checker, 'chart.js'), { config, datasetTypes }, into);
	}
	return into;
}

/** Mixed charts: a dataset without `type` inherits the chart type; plugins may register more types. */
function datasetUnions(emitter, datasetVariants) {
	return new Map(
		[...datasetVariants].map(([datasetType, variants]) => [
			datasetType,
			() => ({
				kind: 'union',
				anyOf: variants.map((variant) => emitter.reference(variant)),
				discriminator: 'type',
				defaultVariant: 0,
				extensible: true
			})
		])
	);
}

export function generateChartjs(root, pin) {
	const { program: registryProgram, chartTypes } = registeredChartTypes(root);
	const { program, checker, entry } = createEntryProgram(root, entryText(chartTypes), registryProgram);
	const aliases = exportedAliasTypes(checker, entry);
	const { datasetVariants, ...adjustments } = contractAdjustments(checker, chartTypes, aliases);
	const emitter = new TypeEmitter({ program, checker, sourceId: SOURCE_ID, packageName: pin.package, wrappers: WRAPPERS, ...adjustments });
	emitter.overrides = datasetUnions(emitter, datasetVariants);
	const configs = chartTypes.map((chartType) => emitter.reference(aliases.get(`Config_${chartType}`)));
	// Element options in every scope the runtime reads them from; open per-property animations.
	const scopes = planOptionScopes(root, emitter.definitions, configs.map(({ ref }) => ref));
	emitter.definitions[ELEMENT_SCOPE] = scopes.scope;
	for (const name of scopes.includedBy) emitter.definitions[name].includes = [ELEMENT_SCOPE];
	for (const name of scopes.openAnimations)
		emitter.definitions[name] = { ...emitter.definitions[name], additional: 'open', provenance: scopes.animationProvenance };
	makeOptionsScriptable(
		emitter.definitions,
		configs.map(({ ref }) => ref)
	);
	return artifactOf({
		library: 'chartjs',
		sourceId: SOURCE_ID,
		pin,
		definitions: emitter.definitions,
		root: { kind: 'union', anyOf: configs, discriminator: 'type', extensible: true }
	});
}

