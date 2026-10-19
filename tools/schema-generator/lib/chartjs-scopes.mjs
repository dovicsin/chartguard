import { runtimePointer } from './runtime.mjs';

/**
 * Chart.js resolves element options through a scope chain that ends at the options root, and
 * with element and hover prefixes (dist/chart.js `datasetElementScopeKeys`, `_resolveElementOptions`),
 * so `options.radius`, `options.pointBackgroundColor` and `datasets[].radius` all reach the
 * point elements. Per-property animations live under `options.animation`, which `animations`
 * falls back to. The declarations describe none of this; `planOptionScopes` works out what to
 * add, citing the runtime, and the generator applies the plan to the definitions it owns.
 */
export const ELEMENT_SCOPE = 'ElementOptionsInScope';
const ELEMENTS = ['point', 'line', 'bar', 'arc'];

const RUNTIME = {
	scopes: { file: 'dist/chart.js', pattern: 'datasetElementScopeKeys(datasetType, elementType) {' },
	prefixes: { file: 'dist/chart.js', pattern: 'const prefixes = active ? [' },
	animations: { file: 'dist/chunks/helpers.dataset.js', pattern: "_fallback: 'animation'" }
};

const changed = (what) => new Error(`chart.js changed: ${what}`);
const compareText = (left, right) => (left < right ? -1 : Number(left > right));

const capitalize = (name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** `radius` → `pointRadius`; `hoverRadius` → `pointHoverRadius`, the `<element>Hover` prefix. */
function prefixed(element, name) {
	return name.startsWith('hover') && name.length > 5 ? `${element}Hover${name.slice(5)}` : `${element}${capitalize(name)}`;
}

/** Records one declared type for a name; a name shared by several elements collects each distinct type. */
function collect(collected, key, property, sources) {
	const entry = collected.get(key) ?? { nodes: [], sources: [...property.provenance.sources, ...sources] };
	if (!entry.nodes.some((node) => JSON.stringify(node) === JSON.stringify(property.node))) entry.nodes.push(property.node);
	collected.set(key, entry);
}

/** Every name an element option is read under (`n` and `<element>N`), with its declared types. */
function elementOptionNames(elements, resolve, sources) {
	const collected = new Map();
	for (const element of ELEMENTS) {
		const declared = resolve(elements.properties[element]?.node ?? { kind: 'unknown' });
		if (declared.kind !== 'object') throw changed(`no declared options for the ${element} element`);
		for (const [name, property] of Object.entries(declared.properties)) {
			collect(collected, name, property, sources);
			collect(collected, prefixed(element, name), property, sources);
		}
	}
	return collected;
}

function scopeDefinition(elements, resolve, sources) {
	const collected = elementOptionNames(elements, resolve, sources);
	const properties = [...collected.keys()].sort(compareText).map((key) => {
		const { nodes, sources: cited } = collected.get(key);
		const node = nodes.length === 1 ? nodes[0] : { kind: 'union', anyOf: nodes };
		return [key, { node, provenance: { confidence: 'authoritative', sources: cited } }];
	});
	return { kind: 'object', additional: 'unknown', properties: Object.fromEntries(properties) };
}

/** Dataset variants of a configuration, reached through `data.datasets[]`. */
function datasetNames(config, resolve) {
	const datasets = resolve(resolve(config.properties.data.node).properties.datasets.node);
	return resolve(datasets.items).anyOf.map((member) => member.ref);
}

/**
 * What to add for the option scopes of the given configurations: the shared element-options
 * definition, the definitions that include it (every `options` and every dataset variant), and the
 * animation spec definitions that become open.
 */
export function planOptionScopes(root, definitions, configNames) {
	const resolve = (node) => (node.kind === 'ref' ? definitions[node.ref] : node);
	const sources = [RUNTIME.scopes, RUNTIME.prefixes].map((fact) => ({ source: 'chartjs', pointer: runtimePointer(root, 'chart.js', fact) }));
	const configs = configNames.map((name) => definitions[name]);
	const optionsNames = configs.map((config) => config.properties.options.node.ref);
	const animationNames = optionsNames.flatMap((name) =>
		(resolve(definitions[name].properties.animation.node).anyOf ?? []).filter((member) => resolve(member).kind === 'object').map((member) => member.ref)
	);
	return {
		scope: scopeDefinition(resolve(definitions[optionsNames[0]].properties.elements.node), resolve, sources),
		includedBy: [...new Set([...optionsNames, ...configs.flatMap((config) => datasetNames(config, resolve))])],
		openAnimations: [...new Set(animationNames)],
		animationProvenance: { confidence: 'authoritative', sources: [{ source: 'chartjs', pointer: runtimePointer(root, 'chart.js', RUNTIME.animations) }] }
	};
}
