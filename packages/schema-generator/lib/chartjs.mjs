import { planPluginHandlers } from './chartjs-plugins.mjs';
import { ELEMENT_SCOPE, planOptionScopes } from './chartjs-scopes.mjs';
import { TypeEmitter } from './emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';
import { runtimeProvenance } from './runtime.mjs';
import { makeOptionsScriptable } from './scriptable.mjs';
import { artifactOf, typeLookups, unionMembers } from './types.mjs';

const SOURCE_ID = 'chartjs';
/**
 * The runtime registries (`Chart.register`) the `type` values are looked up in: every dataset's
 * controller (`dataset.type || config.type`) and every configured scale. The chart `type` itself is
 * read only through its datasets: with none, an unregistered chart type renders, so it is not enforced.
 */
const LOOKUPS = {
	controllers: { file: 'dist/chart.js', pattern: 'const ControllerClass = registry.getController(type);' },
	scales: { file: 'dist/chart.js', pattern: 'const scaleClass = registry.getScale(scaleType);' }
};

function registryFacts(root) {
	const provenance = (fact) => runtimeProvenance(root, { sourceId: SOURCE_ID, packageName: 'chart.js' }, fact);
	const fact = (id, enforced, lookup) => ({ registry: { id, prefix: '', enforced }, provenance: provenance(lookup) });
	return {
		chartType: fact('chartjs.controllers', false, LOOKUPS.controllers),
		dataset: fact('chartjs.controllers', true, LOOKUPS.controllers),
		scale: fact('chartjs.scales', true, LOOKUPS.scales)
	};
}

/** `DeepPartial<T>` / `_DeepPartialObject<T>` (dist/types/utils.d.ts) map over primitives unchanged. */
const WRAPPERS = new Set(['DeepPartial', '_DeepPartialObject']);

/** Chart types as declared by the augmentable `ChartTypeRegistry`. */
function registeredChartTypes(root) {
	const { program, checker, entry } = createEntryProgram(
		root,
		"import type { ChartTypeRegistry } from 'chart.js';\nexport type Registry = keyof ChartTypeRegistry;"
	);
	const registry = exportedAliasTypes(checker, entry).get('Registry');
	return {
		program,
		chartTypes: unionMembers(registry)
			.map((member) => member.value)
			.sort()
	};
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
function adjustChartType(lookups, { config, datasetTypes, facts }, into) {
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
	into.registries.set(indexValueType(propertyType(options, 'scales')), facts.scale);
	into.runtimeOptional.add(property(config, 'data'));
	into.runtimeOptional.add(property(data, 'datasets'));
	for (const dataset of [datasetType, ...datasetTypes]) {
		into.opaque.add(propertyType(dataset, 'data'));
		into.runtimeOptional.add(property(dataset, 'data'));
	}
	into.datasetVariants.set(datasetType, [datasetType, ...datasetTypes]);
}

function contractAdjustments(checker, chartTypes, aliases, facts) {
	const into = {
		opaque: new Set(),
		open: new Set(),
		registries: new Map(),
		runtimeOptional: new Set(),
		widened: new Map(),
		datasetVariants: new Map()
	};
	for (const chartType of chartTypes) {
		const config = aliases.get(`Config_${chartType}`);
		const datasetTypes = chartTypes
			.filter((other) => other !== chartType)
			.map((other) => aliases.get(`Dataset_${other}`));
		adjustChartType(typeLookups(checker, 'chart.js'), { config, datasetTypes, facts }, into);
	}
	return into;
}

/** Mixed charts: a dataset without `type` inherits the chart type; plugins may register more types. */
function datasetUnions(emitter, datasetVariants, { registry, provenance }) {
	return new Map(
		[...datasetVariants].map(([datasetType, variants]) => [
			datasetType,
			() => ({
				kind: 'union',
				anyOf: variants.map((variant) => emitter.reference(variant)),
				discriminator: 'type',
				defaultVariant: 0,
				extensible: true,
				registry,
				provenance
			})
		])
	);
}

/**
 * What the declarations leave out, read from the runtime: element options in every scope the
 * runtime reads them from, open per-property animations, built-in plugin options that take effect
 * only when the plugin is registered; then every option value becomes scriptable.
 */
function withRuntimeFacts(root, definitions, configNames) {
	const scopes = planOptionScopes(root, definitions, configNames);
	const next = { ...definitions, [ELEMENT_SCOPE]: scopes.scope };
	for (const name of scopes.includedBy) next[name] = { ...next[name], includes: [ELEMENT_SCOPE] };
	for (const name of scopes.openAnimations)
		next[name] = { ...next[name], additional: 'open', provenance: scopes.animationProvenance };
	for (const { definition, property, handledBy, sources } of planPluginHandlers(root, definitions, configNames)) {
		const target = next[definition].properties[property];
		const provenance = { ...target.provenance, sources: [...target.provenance.sources, ...sources] };
		next[definition] = {
			...next[definition],
			properties: { ...next[definition].properties, [property]: { ...target, handledBy, provenance } }
		};
	}
	makeOptionsScriptable(next, configNames);
	return next;
}

export function generateChartjs(root, pin) {
	const { program: registryProgram, chartTypes } = registeredChartTypes(root);
	const { program, checker, entry } = createEntryProgram(root, entryText(chartTypes), registryProgram);
	const aliases = exportedAliasTypes(checker, entry);
	const facts = registryFacts(root);
	const { datasetVariants, ...adjustments } = contractAdjustments(checker, chartTypes, aliases, facts);
	const emitter = new TypeEmitter({
		program,
		checker,
		sourceId: SOURCE_ID,
		packageName: pin.package,
		wrappers: WRAPPERS,
		...adjustments
	});
	emitter.overrides = datasetUnions(emitter, datasetVariants, facts.dataset);
	const configs = chartTypes.map((chartType) => emitter.reference(aliases.get(`Config_${chartType}`)));
	const definitions = withRuntimeFacts(
		root,
		emitter.definitions,
		configs.map(({ ref }) => ref)
	);
	return artifactOf({
		library: 'chartjs',
		sourceId: SOURCE_ID,
		pin,
		definitions,
		root: { kind: 'union', anyOf: configs, discriminator: 'type', extensible: true, ...facts.chartType }
	});
}
