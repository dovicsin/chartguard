import { withMismatchEffects } from './chartjs-effects.mjs';
import { planPluginHandlers, pluginDefinitions } from './chartjs-plugins.mjs';
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

/**
 * Scales take plugin variants (`withExtensions`, CG-02-05) at their registry's name; controllers at two
 * points of one registry, `chartjs.charts` and `chartjs.datasets`, since a controller adds a chart type
 * and a dataset type at once (part 2, marked where the unions are built).
 */
function registryFacts(root) {
	const provenance = (fact) => runtimeProvenance(root, { sourceId: SOURCE_ID, packageName: 'chart.js' }, fact);
	const fact = (id, enforced, lookup) => ({ registry: { id, prefix: '', enforced }, provenance: provenance(lookup) });
	return {
		chartType: fact('chartjs.controllers', false, LOOKUPS.controllers),
		dataset: fact('chartjs.controllers', true, LOOKUPS.controllers),
		scale: { ...fact('chartjs.scales', true, LOOKUPS.scales), extensionPoint: 'chartjs.scales' }
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
	return [
		"import type { ChartConfiguration, ChartDataset, ChartOptions } from 'chart.js';",
		// Options of every chart type at once: their `scales` take every scale type.
		'export type AnyOptions = ChartOptions;',
		...lines
	].join('\n');
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
	// getOpts (chart.js `PluginService`): `false` and `null` disable a plugin (`createDescriptors` skips
	// it), `true` enables it with defaults; each plugin entry cites both lines (chartjs-plugins.mjs).
	for (const plugin of lookups.checker.getPropertiesOfType(plugins))
		into.widened.set(declarationOf(plugin), [{ kind: 'boolean' }, { kind: 'null' }]);
	into.scales.add(indexValueType(propertyType(options, 'scales')));
	into.runtimeOptional.add(property(config, 'data'));
	into.runtimeOptional.add(property(data, 'datasets'));
	for (const dataset of [datasetType, ...datasetTypes]) {
		into.opaque.add(propertyType(dataset, 'data'));
		into.runtimeOptional.add(property(dataset, 'data'));
	}
	into.datasetVariants.set(datasetType, [datasetType, ...datasetTypes]);
}

/**
 * The declaration a plugin's option is widened at. `widened` is keyed by declaration: a symbol without
 * one (a key a mapped type synthesizes) would key `undefined`, which every other declaration-less
 * property also looks up, so it would widen them all.
 */
export function declarationOf(symbol) {
	const [declaration] = symbol.declarations ?? [];
	if (declaration === undefined)
		throw new Error(`chart.js types changed: plugin option "${symbol.name}" has no declaration`);
	return declaration;
}

/**
 * Every chart type takes every scale type: the runtime looks a scale's type up in one registry,
 * whatever the chart type (`registry.getScale(scaleType)`), and chooses an untyped scale's type by
 * its axis (`radialLinear` on `r`, `category` or `linear` on `x` and `y`) in any chart. The
 * declarations narrow `scales` by chart type (`ChartTypeRegistry[TType]['scales']`): a radar chart's
 * `x` scale, which the runtime builds as `category`, would be checked as `radialLinear`. Each chart
 * type's scale type is emitted as the scale type of `ChartOptions` over every chart type.
 */
function everyScaleType(lookups, anyOptions, into) {
	const every = lookups.indexValueType(lookups.propertyType(lookups.checker.getNonNullableType(anyOptions), 'scales'));
	return { every, own: [...into.scales].filter((own) => own !== every) };
}

/** Each chart type's scale type emitted as the one of every chart type. */
const scaleOverrides = (emitter, { every, own }) => own.map((type) => [type, () => emitter.emit(every)]);

function contractAdjustments(checker, chartTypes, aliases, facts) {
	const into = {
		opaque: new Set(),
		open: new Set(),
		registries: new Map(),
		runtimeOptional: new Set(),
		widened: new Map(),
		datasetVariants: new Map(),
		scales: new Set()
	};
	for (const chartType of chartTypes) {
		const config = aliases.get(`Config_${chartType}`);
		const datasetTypes = chartTypes
			.filter((other) => other !== chartType)
			.map((other) => aliases.get(`Dataset_${other}`));
		adjustChartType(typeLookups(checker, 'chart.js'), { config, datasetTypes }, into);
	}
	const scales = everyScaleType(typeLookups(checker, 'chart.js'), aliases.get('AnyOptions'), into);
	into.registries.set(scales.every, facts.scale);
	return { ...into, scales };
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
				extensionPoint: 'chartjs.datasets',
				provenance
			})
		])
	);
}

/**
 * `toFont` (dist/chunks/helpers.dataset.js) reads a font's `size` with `parseInt` when it is a string,
 * and tests `style` against its own pattern (`unset`, `oblique 10deg` are styles too): a string is
 * a size, and any string a style the runtime decides itself (A6: runtime-handled values are accepted).
 */
const FONT_FACTS = {
	size: { file: 'dist/chunks/helpers.dataset.js', pattern: 'size = parseInt(size, 10);' },
	style: { file: 'dist/chunks/helpers.dataset.js', pattern: "if (style && !('' + style).match(FONT_STYLE)) {" }
};
const STRING = { kind: 'string' };

/** `node` also accepting a string; a scriptable value widens inside its callback-or-value union. */
function withString(node) {
	if (node.kind === 'scriptable') return { ...node, value: withString(node.value) };
	if (node.kind === 'union') return { ...node, anyOf: [...node.anyOf, STRING] };
	return { kind: 'union', anyOf: [node, STRING] };
}

/** Every font definition (its own `size` and `family`) with the facts of `toFont`, each citing its line. */
function withFontFacts(root, definitions) {
	const cite = (fact) => ({
		source: SOURCE_ID,
		pointer: runtimeProvenance(root, { sourceId: SOURCE_ID, packageName: 'chart.js' }, fact).sources[0].pointer
	});
	const next = { ...definitions };
	for (const [name, definition] of Object.entries(definitions)) {
		const properties = definition.properties ?? {};
		if (properties.size === undefined || properties.family === undefined) continue;
		const widened = Object.fromEntries(
			Object.entries(FONT_FACTS)
				.filter(([key]) => properties[key] !== undefined)
				.map(([key, fact]) => {
					const property = properties[key];
					const provenance = { ...property.provenance, sources: [...property.provenance.sources, cite(fact)] };
					return [key, { ...property, node: withString(property.node), provenance }];
				})
		);
		next[name] = { ...definition, properties: { ...properties, ...widened } };
	}
	return next;
}

/**
 * What the declarations leave out, read from the runtime: element options in every scope the
 * runtime reads them from, open per-property animations, built-in plugin options that take effect
 * only when the plugin is registered, the plugin extension point; then every option value becomes
 * scriptable, fonts take what `toFont` handles, and options the runtime mishandles say how (A73).
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
	for (const name of pluginDefinitions(definitions, configNames))
		next[name] = { ...next[name], extensionPoint: 'chartjs.plugins' };
	makeOptionsScriptable(next, configNames);
	return withMismatchEffects(root, withFontFacts(root, next), configNames);
}

export function generateChartjs(root, pin) {
	const { program: registryProgram, chartTypes } = registeredChartTypes(root);
	const { program, checker, entry } = createEntryProgram(root, entryText(chartTypes), registryProgram);
	const aliases = exportedAliasTypes(checker, entry);
	const facts = registryFacts(root);
	const { datasetVariants, scales, ...adjustments } = contractAdjustments(checker, chartTypes, aliases, facts);
	const emitter = new TypeEmitter({
		program,
		checker,
		sourceId: SOURCE_ID,
		packageName: pin.package,
		wrappers: WRAPPERS,
		...adjustments
	});
	emitter.overrides = new Map([
		...datasetUnions(emitter, datasetVariants, facts.dataset),
		...scaleOverrides(emitter, scales)
	]);
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
		// A controller adds a chart type and a dataset type: two variant points of one registry (CG-02-05 part 2).
		root: {
			kind: 'union',
			anyOf: configs,
			discriminator: 'type',
			extensible: true,
			...facts.chartType,
			extensionPoint: 'chartjs.charts'
		}
	});
}
