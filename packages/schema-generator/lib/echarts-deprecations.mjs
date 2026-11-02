import { resolveIn, upstreamChanged } from './nodes.mjs';
import { runtimePointer } from './runtime.mjs';

/**
 * Options echarts 6.1.0 no longer declares but still reads: its backward-compat preprocessor
 * (lib/preprocessor/backwardCompat.js, registered for every chart by `registerPreprocessor`) copies
 * them into their current name and logs "<old> is deprecated; use <new> instead.". Each becomes a
 * deprecated alias of the current option, typed like it. A rename into a sibling key (`to`) is a safe
 * fix: the runtime already reads the value under that name. A copy into another option (`target`,
 * `emphasis.focus`) is named, never offered as a fix.
 *
 * `within` is the path from the series to the object the runtime renames in (`[]` an item of a list).
 * Not modelled, since the runtime never applies them: gauge `pointer.color` (its branch follows the
 * `pie || gauge` branch, so it is unreachable) and `backgroundStyle` (renamed inside
 * `backgroundStyle.itemStyle`, which the bar background does not read).
 */
const FILE = 'lib/preprocessor/backwardCompat.js';
const BAR_STYLE =
	"var BAR_ITEM_STYLE_MAP = [['borderRadius', 'barBorderRadius'], ['borderColor', 'barBorderColor'], ['borderWidth', 'barBorderWidth']];";
const barStyle = (within, call) =>
	['Radius', 'Color', 'Width'].map((part) => ({
		series: ['bar'],
		within,
		key: `barBorder${part}`,
		to: `border${part}`,
		patterns: [BAR_STYLE, ...call]
	}));
const RENAMES = [
	{
		series: ['line'],
		key: 'clipOverflow',
		to: 'clip',
		patterns: ["deprecateReplaceLog('clipOverflow', 'clip', 'line');"]
	},
	{
		series: ['pie', 'gauge'],
		key: 'clockWise',
		to: 'clockwise',
		patterns: ["deprecateReplaceLog('clockWise', 'clockwise');"]
	},
	{ series: ['map'], key: 'mapType', to: 'map', patterns: ["deprecateReplaceLog('mapType', 'map', 'map');"] },
	...barStyle(['itemStyle'], []),
	...barStyle(['emphasis', 'itemStyle'], ['compatBarItemStyle(seriesOpt.emphasis);']),
	...barStyle(['data', '[]', 'itemStyle'], ['compatBarItemStyle(data[i]);']),
	...barStyle(['data', '[]', 'emphasis', 'itemStyle'], ['compatBarItemStyle(data[i] && data[i].emphasis);']),
	// `option.downplay && !option.blur`: a set `downplay` is an object, so it is truthy whenever it is valid.
	{ series: ['sunburst'], key: 'downplay', to: 'blur', patterns: ['if (option.downplay && !option.blur) {'] },
	{
		series: ['sunburst'],
		within: ['data', '[]'],
		key: 'downplay',
		to: 'blur',
		patterns: ['if (option.downplay && !option.blur) {', 'traverseTree(seriesOpt.data, compatSunburstState);']
	},
	{
		series: ['sunburst'],
		key: 'highlightPolicy',
		target: ['emphasis', 'focus'],
		patterns: ["deprecateReplaceLog('highlightPolicy', 'emphasis.focus', 'sunburst');"]
	},
	// Copied for every series type; an alias only where the series reads `emphasis.scale`.
	{
		series: 'reading',
		key: 'hoverAnimation',
		target: ['emphasis', 'scale'],
		patterns: ["deprecateReplaceLog('hoverAnimation', 'emphasis.scale');"]
	}
];

const changed = upstreamChanged('echarts runtime');
const resolve = (definitions, node) => resolveIn(definitions)(node);

/** The series variant definition names, by their `type` literal. */
function seriesVariants(definitions, option) {
	const series = resolve(definitions, option.properties.series.node);
	const list = series.anyOf.map((member) => resolve(definitions, member)).find((member) => member.kind === 'array');
	const items = resolve(definitions, list.items);
	return new Map(items.anyOf.map((member) => [definitions[member.ref].properties.type.node.value, member.ref]));
}

/** The node at `path` (property names) below definition `name`; undefined when it is not declared. */
function nodeAt(definitions, name, path) {
	let node = { kind: 'ref', ref: name };
	for (const key of path) {
		const property = resolve(definitions, node)?.properties?.[key];
		if (property === undefined) return undefined;
		node = property.node;
	}
	return node;
}

/** The alias property: the current option's value type, deprecated, citing the runtime lines. */
function alias(node, { key, to, target }, pointers) {
	const replacement = to ?? target.join('.');
	return {
		node,
		provenance: { confidence: 'authoritative', sources: pointers.map((pointer) => ({ source: 'echarts', pointer })) },
		deprecated: {
			message: `${key} is deprecated; use ${replacement} instead.`,
			replacement,
			...(to === undefined ? {} : { renameTo: to })
		}
	};
}

/** `definition` with the alias of `rename`, typed like its sibling `to` or like the series' `target`. */
function withAlias(definitions, definition, rename, context) {
	const node =
		rename.to === undefined
			? nodeAt(definitions, context.variant, rename.target)
			: definition?.properties?.[rename.to]?.node;
	if (node === undefined) throw changed(`${context.name} no longer declares ${rename.to ?? rename.target.join('.')}`);
	const property = alias(node, rename, context.pointers);
	return { ...definition, properties: { ...definition.properties, [rename.key]: property } };
}

/** A copy of `definition` whose references to `from` (its recursion: `children`) name `to` instead. */
function retargeted(definition, from, to) {
	return JSON.parse(JSON.stringify(definition), (key, value) => (key === 'ref' && value === from ? to : value));
}

/** The list's items, aliased along the rest of the path. */
function aliasInList(definitions, node, path, at) {
	if (path[0] !== '[]') throw changed(`${at.name} is a list where ${path.join('.')} is expected`);
	const done = aliasAlong(definitions, node.items, path.slice(1), { ...at, name: `${at.name}[]` });
	return { definitions: done.definitions, node: { ...node, items: done.node } };
}

/** The union's object members that have what the path continues with, each aliased. */
function aliasInUnion(definitions, node, path, at) {
	let next = definitions;
	const anyOf = node.anyOf.map((member) => {
		const object = member.kind === 'ref' ? definitions[member.ref] : undefined;
		if (object?.properties?.[path[0] ?? at.rename.to] === undefined) return member;
		const done = aliasAlong(next, member, path, at);
		next = done.definitions;
		return done.node;
	});
	if (next === definitions) throw changed(`${at.name} has no member with ${path[0] ?? at.rename.to}`);
	return { definitions: next, node: { ...node, anyOf } };
}

/** A copy of the referenced definition the series owns, with the alias, or with the path continued in it. */
function aliasInDefinition(definitions, node, path, at) {
	const owned = `${at.name}<compat>`;
	const base = definitions[owned] ?? retargeted(definitions[node.ref], node.ref, owned);
	const ref = { kind: 'ref', ref: owned };
	if (path.length === 0)
		return { definitions: { ...definitions, [owned]: withAlias(definitions, base, at.rename, at) }, node: ref };
	const [key, ...rest] = path;
	const property = base.properties?.[key];
	if (property === undefined) throw changed(`${owned} no longer declares ${key}`);
	const done = aliasAlong(definitions, property.node, rest, { ...at, name: `${at.name}.${key}` });
	const definition = { ...base, properties: { ...base.properties, [key]: { ...property, node: done.node } } };
	return { definitions: { ...done.definitions, [owned]: definition }, node: ref };
}

/**
 * The definitions with the alias added inside the object `node` reaches along `path` (`[]`: the
 * object members of a list's items). Every definition on the way is copied under a name the series
 * owns (`<variant>.<path><compat>`), so other series do not gain the alias; a copy keeps its recursion.
 */
function aliasAlong(definitions, node, path, at) {
	if (node.kind === 'array') return aliasInList(definitions, node, path, at);
	if (node.kind === 'union') return aliasInUnion(definitions, node, path, at);
	if (node.kind !== 'ref') throw changed(`${at.name} is not an object`);
	return aliasInDefinition(definitions, node, path, at);
}

/** One rename applied to one series variant: on the series itself, or in copies of the options it owns. */
function applyRename(definitions, variant, rename, pointers) {
	const at = { variant, rename, pointers, name: variant };
	const [key, ...rest] = rename.within ?? [];
	if (key === undefined) return { ...definitions, [variant]: withAlias(definitions, definitions[variant], rename, at) };
	const property = definitions[variant].properties[key];
	if (property === undefined) throw changed(`${variant} no longer declares ${key}`);
	const done = aliasAlong(definitions, property.node, rest, { ...at, name: `${variant}.${key}` });
	const properties = { ...definitions[variant].properties, [key]: { ...property, node: done.node } };
	return { ...done.definitions, [variant]: { ...definitions[variant], properties } };
}

/** The series a rename applies to: those it names, or every series that declares its target. */
function seriesOf(definitions, variants, rename) {
	if (rename.series !== 'reading') return rename.series;
	return [...variants]
		.filter(([, variant]) => nodeAt(definitions, variant, rename.target) !== undefined)
		.map(([type]) => type);
}

/**
 * New definitions with the runtime's renames as deprecated aliases. An alias inside a nested
 * option (`itemStyle`) goes into a copy owned by that series type: the runtime renames it there only.
 */
export function withDeprecatedAliases(root, definitions, optionName) {
	const variants = seriesVariants(definitions, definitions[optionName]);
	let next = definitions;
	for (const rename of RENAMES) {
		const pointers = rename.patterns.map((pattern) => runtimePointer(root, 'echarts', { file: FILE, pattern }));
		for (const type of seriesOf(definitions, variants, rename)) {
			const variant = variants.get(type);
			if (variant === undefined) throw changed(`no ${type} series`);
			next = applyRename(next, variant, rename, pointers);
		}
	}
	return next;
}
