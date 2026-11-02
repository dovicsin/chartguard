import { itemsOf, type NodeSchema, type Read, readOwn, type SchemaManifest } from '@chartguard/config-core';
import { ownDataProperty } from '@chartguard/core';

/** A value of the pinned runtime and the line it is read from. */
interface Fact {
	readonly value: string;
	readonly pointer: string;
}

/**
 * The scale types each built-in controller's `static overrides.scales` sets (each pointer names the
 * default scale id's entry; its `type` is on the next line), per default scale id, in
 * the runtime's key order: `_index_` and `_value_` stand for the index and the value axis (bar,
 * line), `x`, `y` and `r` for the axis itself. Doughnut and pie charts set none (pie inherits
 * doughnut's overrides as a static class member).
 */
const OVERRIDES: Readonly<Record<string, Readonly<Record<string, Fact>>>> = {
	bar: {
		_index_: { value: 'category', pointer: 'chart.js@4.5.1 dist/chart.js:1392 _index_: { [in class BarController]' },
		_value_: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:1399 _value_: { [in class BarController]' }
	},
	bubble: {
		x: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:1683 x: { [in class BubbleController]' },
		y: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:1686 y: { [in class BubbleController]' }
	},
	doughnut: {},
	line: {
		_index_: { value: 'category', pointer: 'chart.js@4.5.1 dist/chart.js:2096 _index_: { [in class LineController]' },
		_value_: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:2099 _value_: { [in class LineController]' }
	},
	pie: {},
	polarArea: {
		r: { value: 'radialLinear', pointer: 'chart.js@4.5.1 dist/chart.js:2250 r: { [in class PolarAreaController]' }
	},
	radar: { r: { value: 'radialLinear', pointer: 'chart.js@4.5.1 dist/chart.js:2401 r: { [in class RadarController]' } },
	scatter: {
		x: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:2471 x: { [in class ScatterController]' },
		y: { value: 'linear', pointer: 'chart.js@4.5.1 dist/chart.js:2474 y: { [in class ScatterController]' }
	}
};

/**
 * The index axis a controller's dataset defaults set (`defaults.datasets[type].indexAxis`); pie
 * merges doughnut's defaults into its own, since the registry registers a subclass's parent first.
 * Every other built-in leaves it to `options.indexAxis`, else `'x'`.
 */
const INDEX_AXIS: Readonly<Record<string, Fact & { readonly via?: string }>> = {
	doughnut: { value: 'r', pointer: "chart.js@4.5.1 dist/chart.js:1843 indexAxis: 'r' [in class DoughnutController]" },
	pie: {
		value: 'r',
		pointer: "chart.js@4.5.1 dist/chart.js:1843 indexAxis: 'r' [in class DoughnutController]",
		via: 'chart.js@4.5.1 dist/chart.js:4980 parentScope ? defaults.get(parentScope) : {},'
	},
	polarArea: {
		value: 'r',
		pointer: "chart.js@4.5.1 dist/chart.js:2213 indexAxis: 'r', [in class PolarAreaController]"
	},
	radar: { value: 'r', pointer: "chart.js@4.5.1 dist/chart.js:2390 indexAxis: 'r', [in class RadarController]" }
};

const AXES = new Set(['x', 'y', 'r']);
const has = (table: object, key: string): boolean => Object.hasOwn(table, key);
/** The runtime's `a || b`: the first truthy value. */
const truthy = (value: unknown): boolean => Boolean(value);
/** Undecided: a value on the way cannot be read without running code, or the runtime does not decide it here. */
const UNDECIDED = undefined;

/** `getIndexAxis(type, options)`: `options.datasets[type].indexAxis`, `options.indexAxis`, the controller's default, `'x'`. */
function indexAxisOf(config: unknown, type: string): Read {
	for (const read of [
		readOwn(config, 'options', 'datasets', type, 'indexAxis'),
		readOwn(config, 'options', 'indexAxis')
	]) {
		if (!read.known || truthy(read.value)) return read;
	}
	return { known: true, value: has(INDEX_AXIS, type) ? INDEX_AXIS[type]?.value : 'x' };
}

/** `axisFromPosition`. */
function axisFromPosition(position: unknown): string | undefined {
	if (position === 'top' || position === 'bottom') return 'x';
	return position === 'left' || position === 'right' ? 'y' : undefined;
}

/** `determineAxis` from the scale's own options: its id, else `position`, else the id's first letter. */
function axisOf(id: string, scale: unknown): string | undefined {
	if (AXES.has(id)) return id;
	const axis = readOwn(scale, 'axis');
	// An `axis` option is not modelled: the scale keeps the type its own discriminator gives.
	if (!axis.known || truthy(axis.value)) return UNDECIDED;
	const position = readOwn(scale, 'position');
	if (!position.known) return UNDECIDED;
	const first = id.length > 1 ? id.charAt(0).toLowerCase() : '';
	// Otherwise the datasets that name the scale decide, or the runtime throws: not modelled.
	return axisFromPosition(position.value) ?? (AXES.has(first) ? first : UNDECIDED);
}

/** The type `overrides[type].scales` gives a scale on `axis`, by the axis or by its role. */
function chartDefault(config: unknown, chartType: string, axis: string): Read {
	const scales = OVERRIDES[chartType] ?? {};
	if (has(scales, axis)) return { known: true, value: scales[axis]?.value };
	if (!has(scales, '_index_') && !has(scales, '_value_')) return { known: true, value: undefined };
	const index = indexAxisOf(config, chartType);
	if (!index.known) return index;
	return { known: true, value: scales[axis === index.value ? '_index_' : '_value_']?.value };
}

/** The axis a dataset's default scale id stands for (`getAxisFromDefaultScaleID`). */
function axisFromDefaultId(id: string, indexAxis: string): string {
	if (id === '_index_') return indexAxis;
	if (id === '_value_') return indexAxis === 'x' ? 'y' : 'x';
	return id;
}

/** A dataset's controller type (`dataset.type || config.type`); undefined unless it is a built-in. */
function datasetTypeOf(dataset: unknown, chartType: string): string | undefined {
	const own = readOwn(dataset, 'type');
	if (!own.known) return undefined;
	const type = truthy(own.value) ? own.value : chartType;
	return typeof type === 'string' && has(OVERRIDES, type) ? type : undefined;
}

/** A dataset's index axis (`dataset.indexAxis || getIndexAxis(type, options)`); undefined unless a readable name. */
function datasetIndexAxis(config: unknown, dataset: unknown, type: string): string | undefined {
	const own = readOwn(dataset, 'indexAxis');
	if (!own.known) return undefined;
	const index = truthy(own.value) ? own : indexAxisOf(config, type);
	return index.known && typeof index.value === 'string' ? index.value : undefined;
}

/** The type one dataset's controller defaults give scale `id`, when the dataset is bound to it. */
function datasetDefault(config: unknown, chartType: string, dataset: unknown, id: string): Read {
	const type = datasetTypeOf(dataset, chartType);
	if (type === undefined) return { known: false };
	const scales = OVERRIDES[type] ?? {};
	const defaultIds = Object.keys(scales);
	if (defaultIds.length === 0) return { known: true, value: undefined };
	const index = datasetIndexAxis(config, dataset, type);
	if (index === undefined) return { known: false };
	for (const defaultId of defaultIds) {
		const axis = axisFromDefaultId(defaultId, index);
		const bound = readOwn(dataset, `${axis}AxisID`);
		if (!bound.known) return bound;
		if ((truthy(bound.value) ? bound.value : axis) === id) return { known: true, value: scales[defaultId]?.value };
	}
	return { known: true, value: undefined };
}

/** What the datasets' controllers give scale `id`, the first dataset bound to it winning (`mergeIf`). */
function datasetsDefault(config: unknown, chartType: string, id: string): Read {
	const list = readOwn(config, 'data', 'datasets');
	if (!list.known || (list.value !== undefined && !Array.isArray(list.value))) return { known: false };
	const datasets = itemsOf(list.value, '$.data.datasets');
	if (datasets === undefined) return { known: false };
	for (const { value } of datasets) {
		const type = datasetDefault(config, chartType, value, id);
		if (!type.known || type.value !== undefined) return type;
	}
	return { known: true, value: undefined };
}

/**
 * A scale the runtime types itself: no own `type` (even an own `undefined` is kept by the merge, so
 * the discriminator decides it), and no `_proxy` (the runtime ignores such a scale).
 */
function untyped(scale: object): boolean {
	const type = ownDataProperty(scale, 'type');
	const proxy = readOwn(scale, '_proxy');
	return !type.found && !type.accessor && proxy.known && !truthy(proxy.value);
}

/**
 * The type the runtime gives configured scale `id` that names none (`mergeScaleConfig`, then
 * `buildOrUpdateScales`): the chart type's scale defaults by axis or role, else those of the
 * datasets bound to it, else `radialLinear`, `category` or `linear` by its axis. Undefined when the
 * scale names its own type or anything on the way cannot be read. Read from:
 *
 * - 'chart.js@4.5.1 dist/chart.js:5234 return datasetOptions.indexAxis || options.indexAxis || datasetDefaults.indexAxis'
 * - 'chart.js@4.5.1 dist/chart.js:5266 const axis = opts.axis || axisFromPosition(opts.position) || id.length > 1'
 * - 'chart.js@4.5.1 dist/chart.js:5306 const defaultScaleOptions = chartDefaults.scales || {};'
 * - 'chart.js@4.5.1 dist/chart.js:5318 const indexAxis = dataset.indexAxis || getIndexAxis(type, options);'
 * - "chart.js@4.5.1 dist/chart.js:5323 const id = dataset[axis + 'AxisID'] || axis;"
 * - "chart.js@4.5.1 dist/chart.js:5806 dtype: isRadial ? 'radialLinear' : isHorizontal ? 'category' : 'linear'"
 *
 * The runtime's own defaults are assumed, as everywhere in the schema: a caller that changes
 * `Chart.overrides` or registers a scale whose defaults set a `type` under the scale's id is not modelled.
 */
function scaleType(config: unknown, chartType: string, id: string, scale: object): string | undefined {
	const axis = untyped(scale) ? axisOf(id, scale) : UNDECIDED;
	if (axis === undefined) return UNDECIDED;
	const own = chartDefault(config, chartType, axis);
	if (!own.known) return UNDECIDED;
	if (typeof own.value === 'string') return own.value;
	const bound = datasetsDefault(config, chartType, id);
	if (!bound.known) return UNDECIDED;
	if (typeof bound.value === 'string') return bound.value;
	if (axis === 'r') return 'radialLinear';
	return axis === 'x' ? 'category' : 'linear';
}

/**
 * chart.js `isObject` (`[object Object]`), read without running code: an own `Symbol.toStringTag`
 * would change the tag. Whether the object is plain data is left to `readOwn`.
 */
const isObjectLike = (value: unknown): value is object =>
	typeof value === 'object' &&
	value !== null &&
	!Array.isArray(value) &&
	Object.getOwnPropertyDescriptor(value, Symbol.toStringTag) === undefined;

/**
 * The scale types the runtime chooses for the configured scales that name none, by scale id, with
 * the built-in chart type they were decided for; none for a plugin's chart type, whose controller
 * defaults are not known.
 */
function chosenScaleTypes(config: unknown): { chartType: string; types: Map<string, string> } | undefined {
	const chart = readOwn(config, 'type');
	if (!chart.known || typeof chart.value !== 'string' || !has(OVERRIDES, chart.value)) return undefined;
	const scales = readOwn(config, 'options', 'scales');
	if (!scales.known || !isObjectLike(scales.value)) return undefined;
	const chartType = chart.value;
	const types = new Map<string, string>();
	for (const id of Object.keys(scales.value)) {
		const scale = readOwn(scales.value, id);
		if (!scale.known || !isObjectLike(scale.value)) continue;
		const type = scaleType(config, chartType, id, scale.value);
		if (type !== undefined) types.set(id, type);
	}
	return { chartType, types };
}

/** The values of `member`'s `key` property, when it is an enum. */
const namesOf = (member: NodeSchema, key: string): readonly unknown[] => member.properties?.[key]?.enum ?? [];

/** `node.properties[key]`; the generator's contract broke when it is missing. */
function property(node: NodeSchema | undefined, key: string): NodeSchema {
	const value = node?.kind === 'object' ? node.properties?.[key] : undefined;
	if (value === undefined) throw new Error(`The Chart.js schema no longer has ${key} where scale types expect it.`);
	return value;
}

/** `node` with `member` of its union replaced; the generator's contract broke when it is not one. */
function replacing(node: NodeSchema, member: NodeSchema, by: NodeSchema): NodeSchema {
	if (node.anyOf?.includes(member) !== true)
		throw new Error('The Chart.js schema no longer has the union where scale types expect it.');
	return { ...node, anyOf: node.anyOf.map((known) => (known === member ? by : known)) };
}

const withProperty = (node: NodeSchema, key: string, value: NodeSchema): NodeSchema => ({
	...node,
	properties: { ...node.properties, [key]: value }
});

/** The scale union's member for scale type `type`; the generator's contract broke when there is none. */
function memberOf(union: NodeSchema, type: string): number {
	const key = union.discriminator;
	const index =
		key === undefined ? -1 : (union.anyOf?.findIndex((member) => namesOf(member, key).includes(type)) ?? -1);
	if (index === -1) throw new Error(`The Chart.js schema no longer has the ${type} scale where scale types expect it.`);
	return index;
}

/**
 * The schema for one validation: each scale whose type the runtime chooses is checked against that
 * type (its union's default), as a property of the chart type's scale record. Everything else is
 * shared with `manifest`. Every chart type takes every built-in scale type (the generator's contract).
 */
function preselected(manifest: SchemaManifest, chartType: string, types: ReadonlyMap<string, string>): SchemaManifest {
	const { root } = manifest;
	const config = root.anyOf?.find((member) => namesOf(member, 'type').includes(chartType));
	if (config === undefined) return manifest;
	const options = property(config, 'options');
	const scales = property(options, 'scales');
	const record = scales.kind === 'union' ? scales.anyOf?.find((member) => member.kind === 'object') : scales;
	const union = record?.values;
	if (record === undefined || union === undefined)
		throw new Error('The Chart.js schema no longer has a record of scales where scale types expect it.');
	const added = [...types].map(([id, type]): [string, NodeSchema] => [
		id,
		{ ...union, defaultVariant: memberOf(union, type) }
	]);
	const newRecord = { ...record, properties: { ...record.properties, ...Object.fromEntries(added) } };
	const newScales = scales === record ? newRecord : replacing(scales, record, newRecord);
	const newConfig = withProperty(config, 'options', withProperty(options, 'scales', newScales));
	return { ...manifest, root: replacing(root, config, newConfig) };
}

/** Schemas already built per manifest and decision, so that what is derived from a schema is derived once. */
const built = new WeakMap<SchemaManifest, Map<string, SchemaManifest>>();
const MAX_BUILT = 64;

/**
 * The manifest to validate `config` with: one that checks every scale the runtime gives a type
 * (`mergeScaleConfig`, chart.js@4.5.1) against that type. A partial update is checked against the
 * shared manifest: the chart it is merged into decides what it leaves out (A47).
 */
export function withScaleTypes(manifest: SchemaManifest, config: unknown, incomplete: boolean): SchemaManifest {
	if (incomplete) return manifest;
	const chosen = chosenScaleTypes(config);
	if (chosen === undefined || chosen.types.size === 0) return manifest;
	const key = JSON.stringify([chosen.chartType, [...chosen.types]]);
	const cache = built.get(manifest) ?? new Map<string, SchemaManifest>();
	built.set(manifest, cache);
	const known = cache.get(key);
	if (known !== undefined) return known;
	if (cache.size >= MAX_BUILT) cache.clear();
	const next = preselected(manifest, chosen.chartType, chosen.types);
	cache.set(key, next);
	return next;
}
