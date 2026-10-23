import {
	type Extension,
	ExtensionError,
	type NodeSchema,
	type SchemaManifest,
	type VariantSpec
} from '@chartguard/config-core';

/**
 * A Chart.js controller a plugin registers (`Chart.register(FunnelController)`), described by the
 * built-in type it builds on: the chart type and the dataset type it adds both inherit from it
 * (CG-02-05 part 2). `dataset` adds dataset options, `options` adds chart options.
 */
export interface ControllerExtension {
	readonly extends: string;
	readonly dataset?: NodeSchema;
	readonly options?: NodeSchema;
}

/** An extension for Chart.js: options, variants, and controllers. */
export interface ChartjsExtension extends Extension {
	readonly controllers?: Readonly<Record<string, ControllerExtension>>;
}

const CHARTS = 'chartjs.charts';
const DATASETS = 'chartjs.datasets';

/** The core extension a Chart.js extension stands for: each controller as a chart variant and a dataset variant. */
export function asCoreExtension({ controllers = {}, ...extension }: ChartjsExtension): Extension {
	const entries = Object.entries(controllers);
	if (entries.length === 0) return extension;
	const variant = (base: string, schema: NodeSchema | undefined): VariantSpec =>
		schema === undefined ? { extends: base } : { extends: base, schema };
	const charts = Object.fromEntries(
		entries.map(([name, controller]) => [name, variant(controller.extends, undefined)])
	);
	const datasets = Object.fromEntries(
		entries.map(([name, controller]) => [name, variant(controller.extends, controller.dataset)])
	);
	const variants = extension.variants ?? {};
	return {
		...extension,
		variants: {
			...variants,
			[CHARTS]: { ...variants[CHARTS], ...charts },
			[DATASETS]: { ...variants[DATASETS], ...datasets }
		}
	};
}

/** `node.properties[key]` when `node` is an object that has it; the generator's contract otherwise broke. */
function property(node: NodeSchema | undefined, key: string): NodeSchema {
	const value = node?.kind === 'object' ? node.properties?.[key] : undefined;
	if (value === undefined) throw new Error(`The Chart.js schema no longer has ${key} where controllers expect it.`);
	return value;
}

/**
 * A controller's chart config: the built-in one it extends, whose datasets default to the controller's
 * own dataset type (the runtime reads an untyped dataset's controller from the chart type), with the
 * controller's chart options added; one it redefines is redefined for its own chart type only (A32).
 * New nodes only: the built-in schema is shared and never changed.
 */
function controllerConfig(config: NodeSchema, dataset: NodeSchema, options: NodeSchema | undefined): NodeSchema {
	const data = property(config, 'data');
	const datasets = property(data, 'datasets');
	const element = datasets.element;
	if (element?.kind !== 'union')
		throw new Error('The Chart.js schema no longer has a dataset union where controllers expect it.');
	const defaulted: NodeSchema = { ...element, anyOf: [dataset, ...(element.anyOf ?? [])], defaultVariant: 0 };
	const chartOptions = property(config, 'options');
	const withOptions =
		options === undefined
			? chartOptions
			: { ...chartOptions, properties: { ...chartOptions.properties, ...options.properties } };
	const newData = { ...data, properties: { ...data.properties, datasets: { ...datasets, element: defaulted } } };
	return { ...config, properties: { ...config.properties, data: newData, options: withOptions } };
}

const isObjectSchema = (value: unknown): value is NodeSchema =>
	typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'object';

/** Why a controller's chart options are refused: they must be an object schema, or nothing would be added (K13). */
function optionsProblem(id: string, name: string, options: unknown): string | undefined {
	return options === undefined || isObjectSchema(options)
		? undefined
		: `${id}: controller "${name}" options must be an object schema`;
}

/** The resolved extensions with each controller's chart variant completed from its dataset variant and options. */
export function withControllers(manifest: SchemaManifest, extensions: readonly ChartjsExtension[]): SchemaManifest {
	const resolved = manifest.extensions;
	const charts = resolved?.variants.get(CHARTS);
	const datasets = resolved?.variants.get(DATASETS);
	if (resolved === undefined || charts === undefined || datasets === undefined) return manifest;
	const problems = extensions.flatMap(({ id, controllers: own = {} }) =>
		Object.entries(own).flatMap(([name, { options }]) => optionsProblem(id, name, options) ?? [])
	);
	if (problems.length > 0) throw new ExtensionError(problems);
	const controllers = new Map(extensions.flatMap(({ controllers: own = {} }) => Object.entries(own)));
	const completed = new Map(
		[...charts].map(([name, config]) => {
			const dataset = datasets.get(name);
			const controller = controllers.get(name);
			return [
				name,
				dataset === undefined || controller === undefined
					? config
					: controllerConfig(config, dataset, controller.options)
			];
		})
	);
	const variants = new Map([...resolved.variants, [CHARTS, completed]]);
	return { ...manifest, extensions: { ...resolved, variants } };
}
