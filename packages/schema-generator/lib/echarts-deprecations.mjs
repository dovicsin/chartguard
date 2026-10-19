import { runtimePointer } from './runtime.mjs';

/**
 * Options echarts 6.1.0 no longer declares but still reads: its backward-compat preprocessor
 * (lib/preprocessor/backwardCompat.js) copies them into their current name and logs
 * "<old> is deprecated; use <new> instead.". Each becomes a deprecated alias of the current
 * option, with a safe rename: the runtime already reads it under that name.
 */
const FILE = 'lib/preprocessor/backwardCompat.js';
const RENAMES = [
	{
		series: ['line'],
		key: 'clipOverflow',
		to: 'clip',
		pattern: "deprecateReplaceLog('clipOverflow', 'clip', 'line');"
	},
	{
		series: ['pie', 'gauge'],
		key: 'clockWise',
		to: 'clockwise',
		pattern: "deprecateReplaceLog('clockWise', 'clockwise');"
	},
	{ series: ['map'], key: 'mapType', to: 'map', pattern: "deprecateReplaceLog('mapType', 'map', 'map');" },
	...['Radius', 'Color', 'Width'].map((part) => ({
		series: ['bar'],
		within: 'itemStyle',
		key: `barBorder${part}`,
		to: `border${part}`,
		pattern:
			"var BAR_ITEM_STYLE_MAP = [['borderRadius', 'barBorderRadius'], ['borderColor', 'barBorderColor'], ['borderWidth', 'barBorderWidth']];"
	}))
];

const changed = (what) => new Error(`echarts runtime changed: ${what}`);
const resolve = (definitions, node) => (node.kind === 'ref' ? definitions[node.ref] : node);

/** The series variant definition names, by their `type` literal. */
function seriesVariants(definitions, option) {
	const series = resolve(definitions, option.properties.series.node);
	const list = series.anyOf.map((member) => resolve(definitions, member)).find((member) => member.kind === 'array');
	const items = resolve(definitions, list.items);
	return new Map(items.anyOf.map((member) => [definitions[member.ref].properties.type.node.value, member.ref]));
}

/** The alias property: the current option's value type, deprecated with a safe rename, citing the runtime line. */
function alias(target, { key, to }, pointer) {
	return {
		node: target.node,
		provenance: { confidence: 'authoritative', sources: [{ source: 'echarts', pointer }] },
		deprecated: { message: `${key} is deprecated; use ${to} instead.`, replacement: to, renameTo: to }
	};
}

/** A definition with one more alias, copied under its own name when it is shared, so other series do not gain it. */
function withAlias(definitions, name, rename, pointer) {
	const definition = definitions[name];
	const target = definition?.properties?.[rename.to];
	if (target === undefined) throw changed(`${name} no longer declares ${rename.to}`);
	return { ...definition, properties: { ...definition.properties, [rename.key]: alias(target, rename, pointer) } };
}

/** One rename applied to one series variant: on the series itself, or in a copy of its nested option it owns. */
function applyRename(definitions, variant, rename, pointer) {
	if (rename.within === undefined)
		return { ...definitions, [variant]: withAlias(definitions, variant, rename, pointer) };
	const nested = definitions[variant].properties[rename.within];
	const owned = `${variant}.${rename.within}<compat>`;
	const base = definitions[owned] ?? resolve(definitions, nested.node);
	const ownedDefinition = withAlias({ ...definitions, [owned]: base }, owned, rename, pointer);
	const properties = {
		...definitions[variant].properties,
		[rename.within]: { ...nested, node: { kind: 'ref', ref: owned } }
	};
	return { ...definitions, [owned]: ownedDefinition, [variant]: { ...definitions[variant], properties } };
}

/**
 * New definitions with the runtime's renames as deprecated aliases. An alias inside a nested
 * option (`itemStyle`) goes into a copy owned by that series type: the runtime renames it there only.
 */
export function withDeprecatedAliases(root, definitions, optionName) {
	const variants = seriesVariants(definitions, definitions[optionName]);
	let next = definitions;
	for (const rename of RENAMES) {
		const pointer = runtimePointer(root, 'echarts', { file: FILE, pattern: rename.pattern });
		for (const type of rename.series) {
			const variant = variants.get(type);
			if (variant === undefined) throw changed(`no ${type} series`);
			next = applyRename(next, variant, rename, pointer);
		}
	}
	return next;
}
