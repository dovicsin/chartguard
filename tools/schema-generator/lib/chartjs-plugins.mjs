import { runtimePointer } from './runtime.mjs';

/**
 * Built-in plugin options (`options.plugins.legend`, …) take effect only when the plugin is
 * registered: `createDescriptors` (dist/chart.js) reads `options[plugin.id]` for registered plugins
 * only, so the options of a missing one are silently ignored. Each namespace must be the `id` of a
 * plugin in the pinned runtime, or generation fails.
 */
const DESCRIPTORS = { file: 'dist/chart.js', pattern: 'const opts = getOpts(options[id], all);' };

const pluginPointer = (root, id) => runtimePointer(root, 'chart.js', { file: 'dist/chart.js', pattern: `id: '${id}',` });

/**
 * Every built-in plugin namespace under `options.plugins` of the given configurations, with the
 * handler to set and the runtime lines that make it a plugin id. The generator applies the plan.
 */
export function planPluginHandlers(root, definitions, configNames) {
	const descriptors = runtimePointer(root, 'chart.js', DESCRIPTORS);
	const optionsNames = configNames.map((name) => definitions[name].properties.options.node.ref);
	const pluginNames = [...new Set(optionsNames.map((name) => definitions[name].properties.plugins.node.ref))];
	return pluginNames.flatMap((definition) =>
		Object.keys(definitions[definition].properties).map((property) => ({
			definition,
			property,
			handledBy: { id: 'chartjs.plugins', name: property, enforced: false },
			sources: [descriptors, pluginPointer(root, property)].map((pointer) => ({ source: 'chartjs', pointer }))
		}))
	);
}
