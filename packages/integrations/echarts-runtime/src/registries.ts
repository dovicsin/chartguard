import { isContainer, ownDataProperty, type OwnProperty, type RegistryContext } from '@chartguard/core';

/** The part of the `echarts` (or `echarts/core`) namespace the registry context is read from. */
export interface EChartsRuntime {
	readonly ComponentModel?: unknown;
}

const MISSING: OwnProperty = { found: false, accessor: false };
/** An own data property of an object or a function (a model class), never through a getter. */
const read = (value: unknown, key: string): unknown => {
	const readable = isContainer(value) || typeof value === 'function';
	const property = readable ? ownDataProperty(value, key) : MISSING;
	return property.found ? property.value : undefined;
};

/** Both listers close over the class storage and never use `this` (echarts@6.1.0 lib/util/clazz.js). */
type Lister = (mainType?: string) => unknown;
const listerOf = (model: unknown, key: string): Lister | undefined => {
	const method = read(model, key);
	return typeof method === 'function' ? (method as Lister) : undefined;
};

/**
 * The registry context of a live ECharts (CG-04-05): every series and component class it has
 * registered now, as echarts names them (`series.bar`, `dataZoom.slider`, `grid`), read through its
 * own class registry (`ComponentModel.getAllClassMainTypes`/`getClassesByMainType`, echarts@6.1.0
 * `lib/util/clazz.js`). Pass the namespace the application calls `use` on (`echarts/core`), or the
 * full `echarts`. A namespace without that registry gives no context, so no claim.
 */
export function registriesOf(echarts: EChartsRuntime): Readonly<Record<string, RegistryContext>> {
	const model = read(echarts, 'ComponentModel');
	const mainTypes = listerOf(model, 'getAllClassMainTypes');
	const classes = listerOf(model, 'getClassesByMainType');
	if (mainTypes === undefined || classes === undefined) return {};
	const listed = mainTypes();
	if (!Array.isArray(listed)) return {};
	const types = (listed as unknown[]).flatMap((mainType) => {
		const found = typeof mainType === 'string' ? classes(mainType) : undefined;
		return Array.isArray(found) ? (found as unknown[]).map((item) => read(item, 'type')) : [];
	});
	const names = types.filter((type): type is string => typeof type === 'string');
	return { echarts: { names: [...new Set(names)].sort(), complete: true } };
}
