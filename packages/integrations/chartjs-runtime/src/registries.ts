import { isContainer, ownDataProperty, type RegistryContext } from '@chartguard/core';

/** An own data property of the caller's config, never through a getter: undefined when missing or an accessor. */
export function ownValue(value: unknown, key: string): unknown {
	if (!isContainer(value)) return undefined;
	const property = ownDataProperty(value, key);
	return property.found ? property.value : undefined;
}

/**
 * A property of the runtime, read as the runtime exposes it (`Chart` is a class; a bundler may expose
 * it through getters). This is the library, never the caller's config.
 */
const runtime = (value: unknown, key: string): unknown =>
	isContainer(value) || typeof value === 'function' ? (value as Record<string, unknown>)[key] : undefined;

/** The ids a typed registry holds (`registry.controllers.items`), or undefined when it cannot be read. */
function idsOf(registry: unknown, kind: string): string[] | undefined {
	const items = runtime(runtime(registry, kind), 'items');
	return isContainer(items) ? Object.keys(items).sort() : undefined;
}

/**
 * The ids of the inline plugins a config passes (`config.plugins`): Chart.js runs them and reads
 * their options (`options.plugins.<id>`) without a registration. `complete` is false when one cannot be read.
 */
function inlineIds(plugins: unknown): { readonly ids: readonly string[]; readonly complete: boolean } {
	if (plugins === undefined) return { ids: [], complete: true };
	if (!Array.isArray(plugins)) return { ids: [], complete: false };
	// Element by element through own data properties: an element behind a getter is not read (A49).
	const ids = Array.from({ length: plugins.length }, (_, index) => ownValue(ownValue(plugins, String(index)), 'id'));
	const named = ids.filter((id): id is string => typeof id === 'string');
	return { ids: named, complete: named.length === ids.length };
}

/**
 * The registry context of a live Chart.js (CG-04-05): the controllers, scales and plugins `Chart.registry`
 * holds now (chart.js@4.6.1: `registry.getController`/`getScale` throw for any other; a plugin that is
 * neither registered nor inline never runs). Pass the config's own `plugins` so the inline ones count;
 * when one of them cannot be read, the plugins are an incomplete context. The config's plugins are
 * read through own data properties only: none of its getters runs. A `Chart` without a readable registry gives no context, so no claim.
 */
export function registriesOf(
	chart: { readonly registry?: unknown },
	plugins?: unknown
): Readonly<Record<string, RegistryContext>> {
	const registry = runtime(chart, 'registry');
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
