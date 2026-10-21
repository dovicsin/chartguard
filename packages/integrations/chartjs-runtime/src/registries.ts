import { isContainer, isRecord, ownDataProperty, type OwnProperty, type RegistryContext } from '@chartguard/core';

const MISSING: OwnProperty = { found: false, accessor: false };
/** An own data property of an object or a function (`Chart` is a class), never through a getter. */
const read = (value: unknown, key: string): unknown => {
	const readable = isContainer(value) || typeof value === 'function';
	const property = readable ? ownDataProperty(value, key) : MISSING;
	return property.found ? property.value : undefined;
};

/** The ids a typed registry holds (`registry.controllers.items`), or undefined when it cannot be read. */
function idsOf(registry: unknown, kind: string): string[] | undefined {
	const items = read(read(registry, kind), 'items');
	return isContainer(items) ? Object.keys(items).sort() : undefined;
}

/**
 * The ids of the inline plugins a config passes (`config.plugins`): Chart.js runs them and reads
 * their options (`options.plugins.<id>`) without a registration. `complete` is false when one cannot be read.
 */
function inlineIds(plugins: unknown): { readonly ids: readonly string[]; readonly complete: boolean } {
	if (plugins === undefined) return { ids: [], complete: true };
	if (!Array.isArray(plugins)) return { ids: [], complete: false };
	const ids = (plugins as unknown[]).map((plugin) => (isRecord(plugin) ? read(plugin, 'id') : undefined));
	const named = ids.filter((id): id is string => typeof id === 'string');
	return { ids: named, complete: named.length === ids.length };
}

/**
 * The registry context of a live Chart.js (CG-04-05): the controllers, scales and plugins `Chart.registry`
 * holds now (chart.js@4.5.1: `registry.getController`/`getScale` throw for any other; a plugin that is
 * neither registered nor inline never runs). Pass the config's own `plugins` so the inline ones count;
 * when one of them cannot be read, the plugins are an incomplete context. Only own data properties are
 * read: no getter runs. A `Chart` without a readable registry gives no context, so no claim.
 */
export function registriesOf(
	chart: { readonly registry?: unknown },
	plugins?: unknown
): Readonly<Record<string, RegistryContext>> {
	const registry = read(chart, 'registry');
	const controllers = idsOf(registry, 'controllers');
	const scales = idsOf(registry, 'scales');
	const registered = idsOf(registry, 'plugins');
	if (controllers === undefined || scales === undefined || registered === undefined) return {};
	const inline = inlineIds(plugins);
	return {
		'chartjs.controllers': { names: controllers, complete: true },
		'chartjs.scales': { names: scales, complete: true },
		'chartjs.plugins': { names: [...new Set([...registered, ...inline.ids])].sort(), complete: inline.complete }
	};
}
