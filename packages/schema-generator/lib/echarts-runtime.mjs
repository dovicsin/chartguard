import { runtimePointer } from './runtime.mjs';

/**
 * Where echarts 6.1.0 declares less than its runtime reads, shown by the official examples once
 * recursive definitions were checked at every depth (CG-02-03): the matrix dimension reads every
 * level of cells with the same `traverseInitCells` (lib/coord/matrix/MatrixDim.js), where a cell is
 * a string or an object, while the declarations allow strings only at the top level.
 */
const CELLS = {
	file: 'lib/coord/matrix/MatrixDim.js',
	pattern: 'var childrenSpan = traverseInitCells(cellOption.children, firstLeafLocator, level + 1);'
};

/**
 * How the graphic component reads its option (lib/component/graphic/install.js and GraphicView.js):
 * with `elements` it is the component, otherwise it is an element (or a list of them) and wrapped as
 * one; an element's `type` is looked up among the elements that are not shapes (`group`, `image`,
 * `text`) and the shapes registered with `registerShape`, so a path element's `type` is one of those
 * shapes, or one an application registered (extensible).
 */
const GRAPHIC = {
	component: {
		file: 'lib/component/graphic/install.js',
		pattern: '} else if (graphicOption && !graphicOption.elements) {'
	},
	shapes: { file: 'lib/util/graphic.js', pattern: "registerShape('circle', Circle);" },
	lookup: {
		file: 'lib/component/graphic/GraphicView.js',
		pattern: '? nonShapeGraphicElements[graphicType] : graphicUtil.getShapeClass(graphicType);'
	}
};
/** The element union `elements` and a group's `children` share, stored once (D2). */
const ELEMENT_UNION = 'GraphicComponentElementOption';
const SHAPE_TYPE = 'GraphicShapeType';

/**
 * EC4 style keys echarts still reads on a text element (`convertFromEC4CompatibleStyle`,
 * lib/util/styleCompat.js): each is copied into its current key. Deprecated aliases without a
 * rename: the copy happens only while the style counts as legacy (`isEC4CompatibleStyle`), so
 * renaming could change what is drawn.
 */
const EC4_TEXT = {
	file: 'lib/util/styleCompat.js',
	keys: {
		textStrokeWidth: 'lineWidth',
		textAlign: 'align',
		textVerticalAlign: 'verticalAlign',
		textLineHeight: 'lineHeight',
		textWidth: 'width',
		textHeight: 'height',
		textBackgroundColor: 'backgroundColor',
		textPadding: 'padding',
		textBorderColor: 'borderColor',
		textBorderWidth: 'borderWidth',
		textBorderRadius: 'borderRadius',
		textBoxShadowColor: 'shadowColor',
		textBoxShadowBlur: 'shadowBlur',
		textBoxShadowOffsetX: 'shadowOffsetX',
		textBoxShadowOffsetY: 'shadowOffsetY'
	}
};
const TEXT_STYLE = 'TextStyleProps & TransitionOptionMixin<TextStyleProps>';
/** The shapes echarts 6.1.0 registers (the `registerShape` calls after `GRAPHIC.shapes`). */
const SHAPES = ['circle', 'ellipse', 'sector', 'ring', 'polygon', 'polyline', 'rect', 'line', 'bezierCurve', 'arc'];
const ELEMENTS = [
	'GraphicComponentGroupOption',
	'GraphicComponentZRPathOption',
	'GraphicComponentImageOption',
	'GraphicComponentTextOption'
];
const COMPONENT = 'GraphicComponentOption';

const changed = (what) => new Error(`echarts types changed: ${what}`);

/** The element or component a definition name is (with or without the `mainType` intersection). */
const graphicKind = (ref) => [...ELEMENTS, COMPONENT].find((name) => ref === name || ref.startsWith(`${name} & `));

/** A union of graphic element (and component) references, told apart as the graphic component does. */
function graphicUnion(node, sources, shared) {
	if (node.kind !== 'union') return node;
	const kinds = node.anyOf.map((member) => {
		if (member.kind === 'ref') return graphicKind(member.ref);
		return member.kind === 'array' ? 'array' : undefined;
	});
	const objects = kinds.filter((kind) => kind !== 'array');
	if (objects.length < 2 || !objects.every((kind) => kind !== undefined)) return node;
	const component = kinds.indexOf(COMPONENT);
	const union = {
		...node,
		discriminator: 'type',
		extensible: true,
		...(component < 0 ? {} : { selectWhen: [{ test: 'truthy', property: 'elements', variant: component }] }),
		provenance: { confidence: 'authoritative', sources }
	};
	if (component >= 0) return union;
	// The element union of `elements` and `children` appears under many properties: stored once.
	shared.set(ELEMENT_UNION, union);
	return { kind: 'ref', ref: ELEMENT_UNION };
}

/** The text element's style with the EC4 keys echarts still reads, each a deprecated alias of its current key. */
function withEc4TextStyle(root, definitions) {
	const style = definitions[TEXT_STYLE];
	if (style?.kind !== 'object') throw changed(TEXT_STYLE);
	const aliases = Object.entries(EC4_TEXT.keys).map(([key, to]) => {
		const target = style.properties[to];
		if (target === undefined) throw changed(`${TEXT_STYLE}.${to}`);
		const pattern = `hasOwn(richItem, '${key}') && (out.${to} = richItem.${key});`;
		const pointer = runtimePointer(root, 'echarts', { file: EC4_TEXT.file, pattern });
		return [
			key,
			{
				node: target.node,
				provenance: { confidence: 'authoritative', sources: [{ source: 'echarts', pointer }] },
				deprecated: { message: `${key} is an echarts 4 style; use ${to} instead.`, replacement: to }
			}
		];
	});
	return {
		...definitions,
		[TEXT_STYLE]: { ...style, properties: { ...style.properties, ...Object.fromEntries(aliases) } }
	};
}

/** Every graphic element union, at any depth of any definition. */
function mapNodes(node, map) {
	if (node === null || typeof node !== 'object') return node;
	const mapped = Array.isArray(node)
		? node.map((item) => mapNodes(item, map))
		: Object.fromEntries(Object.entries(node).map(([key, value]) => [key, mapNodes(value, map)]));
	return Array.isArray(node) ? mapped : map(mapped);
}

/** New definitions where graphic elements are told apart by `type`, and a path element's `type` is a registered shape. */
function withGraphicFacts(root, definitions) {
	const cite = (fact) => ({ source: 'echarts', pointer: runtimePointer(root, 'echarts', fact) });
	const sources = [cite(GRAPHIC.component), cite(GRAPHIC.lookup)];
	const shared = new Map();
	const next = Object.fromEntries(
		Object.entries(definitions).map(([name, definition]) => [
			name,
			mapNodes(definition, (node) => graphicUnion(node, sources, shared))
		])
	);
	for (const [name, union] of shared) next[name] = union;
	const paths = Object.keys(next).filter(
		(name) =>
			graphicKind(name) === 'GraphicComponentZRPathOption' || name === 'Omit<GraphicComponentZRPathOption, "clipPath">'
	);
	if (paths.length === 0) throw changed('GraphicComponentZRPathOption');
	// The shape names, stored once for every path element definition (D2).
	next[SHAPE_TYPE] = { kind: 'union', anyOf: SHAPES.map((value) => ({ kind: 'literal', value })) };
	for (const name of paths) {
		const type = next[name].properties?.type;
		if (type?.node.kind !== 'string') throw changed(`${name}.type`);
		const node = { kind: 'ref', ref: SHAPE_TYPE };
		const provenance = { ...type.provenance, sources: [...type.provenance.sources, cite(GRAPHIC.shapes)] };
		next[name] = { ...next[name], properties: { ...next[name].properties, type: { ...type, node, provenance } } };
	}
	return next;
}

/** New definitions where a matrix cell's `children` also take strings, citing the runtime line. */
export function withRuntimeFacts(root, definitions) {
	const cell = definitions.MatrixDimensionCellOption;
	const children = cell?.properties.children;
	if (children?.node.kind !== 'array') throw changed('MatrixDimensionCellOption.children');
	const pointer = runtimePointer(root, 'echarts', CELLS);
	const items = { kind: 'union', anyOf: [{ kind: 'string' }, children.node.items] };
	const provenance = {
		...children.provenance,
		sources: [...children.provenance.sources, { source: 'echarts', pointer }]
	};
	const widened = { ...children, node: { kind: 'array', items }, provenance };
	return withEc4TextStyle(
		root,
		withGraphicFacts(root, {
			...definitions,
			MatrixDimensionCellOption: { ...cell, properties: { ...cell.properties, children: widened } }
		})
	);
}
