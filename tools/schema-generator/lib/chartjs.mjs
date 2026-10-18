import { TypeEmitter } from './emitter.mjs';
import { createEntryProgram, exportedAliasTypes } from './program.mjs';

const SOURCE_ID = 'chartjs';

function propertyType(checker, type, name) {
	const symbol = checker.getPropertyOfType(type, name);
	if (symbol === undefined) throw new Error(`chart.js types changed: no "${name}" property`);
	return checker.getNonNullableType(checker.getTypeOfSymbol(symbol));
}

function elementType(checker, arrayType) {
	const [element] = checker.getTypeArguments(arrayType);
	if (element === undefined) throw new Error('chart.js types changed: expected an array type');
	return element;
}

/** Chart types as declared by the augmentable `ChartTypeRegistry`. */
function registeredChartTypes(root) {
	const { checker, entry } = createEntryProgram(
		root,
		"import type { ChartTypeRegistry } from 'chart.js';\nexport type Registry = keyof ChartTypeRegistry;"
	);
	const registry = exportedAliasTypes(checker, entry).get('Registry');
	const members = registry.isUnion() ? registry.types : [registry];
	return members.map((member) => member.value).sort();
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
 * and `options.plugins` is extended by third-party plugins through declaration merging.
 */
function contractAdjustments(checker, chartTypes, aliases) {
	const opaque = new Set();
	const open = new Set();
	const datasetVariants = new Map();
	for (const chartType of chartTypes) {
		const config = aliases.get(`Config_${chartType}`);
		const data = propertyType(checker, config, 'data');
		const datasetType = elementType(checker, propertyType(checker, data, 'datasets'));
		opaque.add(propertyType(checker, datasetType, 'data'));
		opaque.add(elementType(checker, propertyType(checker, config, 'plugins')));
		open.add(propertyType(checker, propertyType(checker, config, 'options'), 'plugins'));
		const others = chartTypes.filter((other) => other !== chartType).map((other) => aliases.get(`Dataset_${other}`));
		for (const other of others) opaque.add(propertyType(checker, other, 'data'));
		datasetVariants.set(datasetType, [datasetType, ...others]);
	}
	return { opaque, open, datasetVariants };
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
	const chartTypes = registeredChartTypes(root);
	const { program, checker, entry } = createEntryProgram(root, entryText(chartTypes));
	const aliases = exportedAliasTypes(checker, entry);
	const { opaque, open, datasetVariants } = contractAdjustments(checker, chartTypes, aliases);
	const emitter = new TypeEmitter({ program, checker, sourceId: SOURCE_ID, opaque, open });
	emitter.overrides = datasetUnions(emitter, datasetVariants);
	const configs = chartTypes.map((chartType) => emitter.reference(aliases.get(`Config_${chartType}`)));
	return {
		irVersion: 1,
		library: 'chartjs',
		libraryVersion: pin.version,
		// Not full until official examples pass against the runtime (CG-01-08).
		coverage: 'partial',
		generator: { name: '@chartguard/schema-generator', version: '0.1.0' },
		sources: {
			[SOURCE_ID]: {
				kind: 'npm-package',
				locator: `${pin.package}@${pin.version}`,
				integrity: pin.integrity,
				license: pin.license.spdx
			}
		},
		definitions: emitter.definitions,
		root: { kind: 'union', anyOf: configs, discriminator: 'type', extensible: true }
	};
}

