import { runtimeProvenance } from './runtime.mjs';

/**
 * ECharts picks a component's subtype at runtime (`registerSubTypeDefaulter`), while the
 * declarations type every variant's `type` as plain `string`. This pass writes the runtime's
 * choice into the IR, each fact citing the line of the pinned package it comes from.
 */

/** Variant definition name → the runtime subtype literal, and the default subtype. */
const COMPONENTS = {
	dataZoom: {
		variants: {
			SliderDataZoomOption: {
				literal: 'slider',
				file: 'lib/component/dataZoom/SliderZoomModel.js',
				pattern: "SliderZoomModel.type = 'dataZoom.slider'"
			},
			InsideDataZoomOption: {
				literal: 'inside',
				file: 'lib/component/dataZoom/InsideZoomModel.js',
				pattern: "InsideZoomModel.type = 'dataZoom.inside'"
			}
		},
		default: {
			literal: 'slider',
			file: 'lib/component/dataZoom/installCommon.js',
			pattern: "registerSubTypeDefaulter('dataZoom'"
		}
	},
	legend: {
		variants: {
			LegendOption: {
				literal: 'plain',
				file: 'lib/component/legend/LegendModel.js',
				pattern: "LegendModel.type = 'legend.plain'"
			},
			ScrollableLegendOption: {
				literal: 'scroll',
				file: 'lib/component/legend/ScrollableLegendModel.js',
				pattern: "ScrollableLegendModel.type = 'legend.scroll'"
			}
		},
		default: {
			literal: 'plain',
			file: 'lib/component/legend/installLegendPlain.js',
			pattern: "registerSubTypeDefaulter('legend'"
		}
	},
	timeline: {
		// The base option and the slider option are identical; `slider` is the only registered subtype.
		variants: {
			TimelineOption: {
				literal: 'slider',
				file: 'lib/component/timeline/SliderTimelineModel.js',
				pattern: "SliderTimelineModel.type = 'timeline.slider'"
			},
			SliderTimelineOption: {
				literal: 'slider',
				file: 'lib/component/timeline/SliderTimelineModel.js',
				pattern: "SliderTimelineModel.type = 'timeline.slider'"
			}
		},
		default: {
			literal: 'slider',
			file: 'lib/component/timeline/install.js',
			pattern: "registerSubTypeDefaulter('timeline'"
		}
	},
	visualMap: {
		variants: {
			ContinuousVisualMapOption: {
				literal: 'continuous',
				file: 'lib/component/visualMap/ContinuousModel.js',
				pattern: "ContinuousModel.type = 'visualMap.continuous'"
			},
			PiecewiseVisualMapOption: {
				literal: 'piecewise',
				file: 'lib/component/visualMap/PiecewiseModel.js',
				pattern: "PiecewiseModel.type = 'visualMap.piecewise'"
			}
		},
		// The whole expression is the pattern: a change to it fails generation instead of going stale.
		default: {
			literal: 'continuous',
			file: 'lib/component/visualMap/installCommon.js',
			pattern:
				"return !option.categories && (!(option.pieces ? option.pieces.length > 0 : option.splitNumber > 0) || option.calculable) ? 'continuous' : 'piecewise';"
		},
		when: [
			{ test: 'truthy', property: 'categories', literal: 'piecewise' },
			{ test: 'truthy', property: 'calculable', literal: 'continuous' },
			{ test: 'nonEmpty', property: 'pieces', literal: 'piecewise' },
			{ test: 'truthy', property: 'pieces', literal: 'continuous' },
			{ test: 'positive', property: 'splitNumber', literal: 'piecewise' }
		]
	}
};

/** Component subtypes are looked up as `<mainType>.<subType>`; one that is not registered throws. */
const SUBTYPE_LOOKUP = {
	file: 'lib/util/clazz.js',
	pattern: "'Component ' + mainType + '.' + (subType || '') + ' is used but not imported.'"
};

/** Every axis created by `axisModelCreator` resolves its type with `getAxisType`. */
const AXES = ['xAxis', 'yAxis', 'angleAxis', 'radiusAxis', 'singleAxis', 'parallelAxis'];
const AXIS_TYPE = {
	file: 'lib/coord/axisModelCreator.js',
	pattern: "option.type || (option.data ? 'category' : 'value')"
};

const changed = (what) => new Error(`echarts runtime changed: ${what}`);

const provenance = (root, fact) => runtimeProvenance(root, { sourceId: 'echarts', packageName: 'echarts' }, fact);

/** The union a root property holds, and the union of its array items when it is `T | T[]`. */
function unionsOf(definitions, node) {
	const resolve = (candidate) => (candidate.kind === 'ref' ? definitions[candidate.ref] : candidate);
	const outer = resolve(node);
	if (outer.kind !== 'union') throw changed('expected a union');
	const list = outer.anyOf.map(resolve).find((member) => member.kind === 'array');
	return list === undefined ? [outer] : [outer, resolve(list.items)];
}

const memberName = (member) => (member.kind === 'ref' ? member.ref : undefined);

function subtypeComponent(root, definitions, union, [mainType, component]) {
	const objects = union.anyOf.filter((member) => member.kind === 'ref');
	for (const member of objects) {
		const variant = component.variants[memberName(member)];
		if (variant === undefined) throw changed(`unexpected variant ${String(memberName(member))}`);
		const typed = definitions[member.ref].properties.type;
		typed.node = { kind: 'literal', value: variant.literal };
		typed.provenance = provenance(root, variant);
	}
	const indexOf = (literal) =>
		union.anyOf.findIndex((member) => component.variants[memberName(member)]?.literal === literal);
	const defaultWhen = (component.when ?? []).map(({ literal, ...rule }) => ({ ...rule, variant: indexOf(literal) }));
	Object.assign(union, {
		discriminator: 'type',
		defaultVariant: indexOf(component.default.literal),
		...(defaultWhen.length === 0 ? {} : { defaultWhen }),
		extensible: true,
		registry: { id: 'echarts', prefix: `${mainType}.`, enforced: true },
		// Extension subtypes (`dataZoom.custom`) are added like extension series (CG-02-05 part 2).
		extensionPoint: 'echarts',
		provenance: {
			confidence: 'authoritative',
			sources: [component.default, SUBTYPE_LOOKUP].flatMap((fact) => provenance(root, fact).sources)
		}
	});
}

function axisDefaults(root, definitions, union) {
	const indexOf = (literal) =>
		union.anyOf.findIndex(
			(member) => member.kind === 'ref' && definitions[member.ref].properties.type?.node.value === literal
		);
	const [category, value] = [indexOf('category'), indexOf('value')];
	if (category === -1 || value === -1) throw changed('axis variants');
	Object.assign(union, {
		defaultWhen: [{ test: 'truthy', property: 'data', variant: category }],
		defaultVariant: value,
		provenance: provenance(root, AXIS_TYPE)
	});
}

/** Rewrites, in place, the component and axis unions under the root `EChartsOption` definition. */
export function resolveComponentSubtypes(root, definitions, option) {
	for (const entry of Object.entries(COMPONENTS))
		for (const union of unionsOf(definitions, option.properties[entry[0]].node))
			subtypeComponent(root, definitions, union, entry);
	for (const name of AXES)
		for (const union of unionsOf(definitions, option.properties[name].node)) axisDefaults(root, definitions, union);
}
