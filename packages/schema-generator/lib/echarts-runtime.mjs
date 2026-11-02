import { upstreamChanged } from './nodes.mjs';
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

const changed = upstreamChanged('echarts types');

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

/**
 * How echarts merges the root option (`GlobalModel._mergeOption`, lib/model/Global.js): a `null`
 * root option is skipped like an absent one; a root option of a component (`ComponentModel.hasClass`)
 * is read as a list (`normalizeToArray`: one value is a list of one), and `mappingToExists`
 * (lib/util/model.js) sets every entry that is not an object to `null` and skips it (CG-02-10).
 * The components are the root options of `EChartsOption` the full bundle registers a model for
 * (`aria` is a global option), checked against the runtime's `hasClass` by the generator tests.
 *
 * Preprocessors read some components before that skip, and throw on what they cannot read: the
 * layout compatibility runs `'x' in option` on every truthy entry of nine components; the radar,
 * polar, brush, toolbox and timeline preprocessors read a property of every listed entry, so a
 * listed `null` throws; axisPointer reads the model of its first entry while drawing; and any
 * brush value but `null` adds the brush buttons to the toolbox, so none is without effect. Which kinds
 * of value each component skips, given alone (`value`) or listed (`entries`), follows from those
 * lines; the conformance tests run every kind on every component against the runtime.
 */
const ROOT_MERGE = {
	nullSkipped: { file: 'lib/model/Global.js', pattern: 'if (componentOption == null) {' },
	listed: {
		file: 'lib/model/Global.js',
		pattern:
			'var newCmptOptionList = concatInternalOptions(this, mainType, modelUtil.normalizeToArray(newOption[mainType]));'
	},
	skipped: { file: 'lib/util/model.js', pattern: 'if (!isObject(cmptOption)) {' }
};
const THROWS = {
	layout: { file: 'lib/preprocessor/backwardCompat.js', pattern: 'if (prop[0] in option && !(prop[1] in option)) {' },
	radar: {
		file: 'lib/preprocessor/helper/compatStyle.js',
		pattern: 'if (radarOpt.name && radarOpt.axisName == null) {'
	},
	polar: { file: 'lib/chart/radar/backwardCompat.js', pattern: 'if (polarOpt.indicator) {' },
	brush: {
		file: 'lib/component/brush/preprocessor.js',
		pattern: "var tbs = brushOpt.hasOwnProperty('toolbox') ? brushOpt.toolbox : [];"
	},
	brushToolbox: {
		file: 'lib/component/brush/preprocessor.js',
		pattern: 'var brushComponents = normalizeToArray(option ? option.brush : []);'
	},
	toolbox: {
		file: 'lib/preprocessor/helper/compatStyle.js',
		pattern: 'each(toolboxOpt.feature, function (featureOpt) {'
	},
	timeline: { file: 'lib/preprocessor/helper/compatStyle.js', pattern: 'var data = timelineOpt.data;' },
	axisPointer: {
		file: 'lib/component/axisPointer/modelHelper.js',
		pattern: "var linksOption = globalAxisPointerModel.get('link', true) || [];"
	}
};
const EVERY = { value: ['falsy', 'truthy'], entries: ['null', 'falsy', 'truthy'] };
const FALSY = { value: ['falsy'], entries: ['null', 'falsy'] };
const NOT_NULL = { value: ['falsy', 'truthy'], entries: ['falsy', 'truthy'] };
const FALSY_NOT_NULL = { value: ['falsy'], entries: ['falsy'] };
/** By component: which kinds it skips, and the lines that throw on the others. */
const COMPONENTS = {
	dataset: [EVERY],
	title: [FALSY, 'layout'],
	grid: [FALSY, 'layout'],
	radar: [NOT_NULL, 'radar'],
	polar: [NOT_NULL, 'polar'],
	geo: [FALSY, 'layout'],
	angleAxis: [EVERY],
	radiusAxis: [EVERY],
	xAxis: [EVERY],
	yAxis: [EVERY],
	singleAxis: [EVERY],
	parallel: [FALSY, 'layout'],
	parallelAxis: [EVERY],
	calendar: [EVERY],
	matrix: [EVERY],
	toolbox: [FALSY_NOT_NULL, 'layout', 'toolbox'],
	tooltip: [EVERY],
	axisPointer: [{ value: ['falsy'], entries: [] }, 'axisPointer'],
	// Any brush value but `null` adds the brush buttons to the toolbox: none is without effect.
	brush: [{ value: [], entries: [] }, 'brush', 'brushToolbox'],
	timeline: [FALSY_NOT_NULL, 'layout', 'timeline'],
	legend: [FALSY, 'layout'],
	dataZoom: [FALSY, 'layout'],
	visualMap: [FALSY, 'layout'],
	thumbnail: [EVERY],
	graphic: [EVERY],
	series: [EVERY]
};

/** The option with `null` root options absent and each component option skipping what its runtime skips. */
function withRootMerge(root, definitions, optionName) {
	const option = definitions[optionName];
	if (option?.kind !== 'object') throw changed(optionName);
	const cite = (fact) => ({ source: 'echarts', pointer: runtimePointer(root, 'echarts', fact) });
	const listed = [cite(ROOT_MERGE.listed), cite(ROOT_MERGE.skipped)];
	const properties = { ...option.properties };
	for (const [key, [skips, ...throwing]] of Object.entries(COMPONENTS)) {
		const property = properties[key];
		if (property === undefined) throw changed(`${optionName}.${key}`);
		const sources = [...property.provenance.sources, ...listed, ...throwing.map((name) => cite(THROWS[name]))];
		properties[key] = { ...property, skips, provenance: { ...property.provenance, sources } };
	}
	const provenance = { ...option.provenance, sources: [...option.provenance.sources, cite(ROOT_MERGE.nullSkipped)] };
	return { ...definitions, [optionName]: { ...option, nullAsAbsent: true, provenance, properties } };
}

/**
 * `hoverOffset` on a pie or gauge series: the backward-compat preprocessor means to copy it into
 * `emphasis.scaleSize`, but its test is an assignment (`if (seriesOpt.emphasis.scaleSize = null)`),
 * so it never copies and it erases `emphasis.scaleSize`. Declared, citing that line, so the
 * `echarts/hover-offset` rule can say what it does instead of an unknown key; any value has the same
 * effect, so its type is not stated (CG-02-11).
 */
const HOVER_OFFSET = { file: 'lib/preprocessor/backwardCompat.js', pattern: 'if (seriesOpt.hoverOffset != null) {' };
const HOVER_OFFSET_SERIES = ['PieSeriesOption$1', 'GaugeSeriesOption$1'];

function withHoverOffset(root, definitions) {
	const pointer = runtimePointer(root, 'echarts', HOVER_OFFSET);
	const next = { ...definitions };
	for (const name of HOVER_OFFSET_SERIES) {
		const series = next[name];
		if (series?.kind !== 'object' || series.properties.hoverOffset !== undefined) throw changed(`${name}.hoverOffset`);
		const hoverOffset = {
			node: { kind: 'unknown' },
			provenance: { confidence: 'authoritative', sources: [{ source: 'echarts', pointer }] }
		};
		next[name] = { ...series, properties: { ...series.properties, hoverOffset } };
	}
	return next;
}

/** New definitions where a matrix cell's `children` also take strings, citing the runtime line. */
export function withRuntimeFacts(root, definitions, optionName) {
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
	const facts = withEc4TextStyle(
		root,
		withGraphicFacts(root, {
			...definitions,
			MatrixDimensionCellOption: { ...cell, properties: { ...cell.properties, children: widened } }
		})
	);
	return withHoverOffset(root, withRootMerge(root, facts, optionName));
}
